import type {
  ClassSectionWire,
  CourseWire,
  TermStatus,
  TermWire,
} from '@ddl-tracker/contracts';

export interface TermRecord {
  id: string;
  externalCode: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  statusOverride: 'active' | 'archived' | null;
}

export interface CourseRecord {
  id: string;
  externalCourseCode: string;
  name: string;
  credits: string | null;
}

export interface ClassSectionRecord {
  id: string;
  externalSectionId: string;
  sectionNumber: string;
  departmentCode: string | null;
  departmentName: string | null;
  instructors: string[];
  campus: string | null;
  capacity: number | null;
  scheduleText: string | null;
  active: boolean;
  revision: number;
}

export interface CatalogRepository {
  listTerms(): Promise<TermRecord[]>;
  listCourses(termId: string): Promise<CourseRecord[]>;
  listClassSections(courseId: string): Promise<ClassSectionRecord[]>;
}

function shanghaiDateParts(now: Date): {
  date: string;
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('Unable to derive Asia/Shanghai local date.');
  }
  return {
    date: `${year}-${month}-${day}`,
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
}

function termOrdinal(externalCode: string): number | null {
  const match = /^(\d{4})-(\d{4})-([123])$/u.exec(externalCode);
  if (match === null) return null;
  const firstYear = Number(match[1]);
  const secondYear = Number(match[2]);
  const semester = Number(match[3]);
  if (secondYear !== firstYear + 1) return null;
  return firstYear * 3 + semester;
}

function currentTermOrdinal(parts: {
  year: number;
  month: number;
  day: number;
}): number {
  if (parts.month <= 2) return (parts.year - 1) * 3 + 1;
  if (parts.month <= 6) return (parts.year - 1) * 3 + 2;
  if (parts.month === 7 || (parts.month === 8 && parts.day < 20)) {
    return (parts.year - 1) * 3 + 3;
  }
  return parts.year * 3 + 1;
}

export function deriveTermStatus(
  term: Pick<
    TermRecord,
    'externalCode' | 'startsOn' | 'endsOn' | 'statusOverride'
  >,
  now: Date,
): TermStatus {
  if (term.statusOverride === 'archived') {
    return 'archived';
  }
  if (term.statusOverride === 'active') {
    return 'in_progress';
  }

  const local = shanghaiDateParts(now);
  const today = local.date;
  if (term.endsOn !== null && today > term.endsOn) {
    return 'archived';
  }
  if (term.startsOn !== null && today < term.startsOn) {
    return 'upcoming';
  }
  if (term.startsOn === null && term.endsOn === null) {
    const ordinal = termOrdinal(term.externalCode);
    if (ordinal !== null) {
      const current = currentTermOrdinal(local);
      if (ordinal < current) return 'archived';
      if (ordinal > current) return 'upcoming';
    }
  }
  return 'in_progress';
}

export class CatalogService {
  readonly #repository: CatalogRepository;
  readonly #now: () => Date;

  constructor(options: { repository: CatalogRepository; now?: () => Date }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
  }

  async listTerms(): Promise<TermWire[]> {
    const now = this.#now();
    return (await this.#repository.listTerms()).map((term) => ({
      id: term.id,
      external_code: term.externalCode,
      name: term.name,
      starts_on: term.startsOn,
      ends_on: term.endsOn,
      status: deriveTermStatus(term, now),
    }));
  }

  async listCourses(termId: string): Promise<CourseWire[]> {
    return (await this.#repository.listCourses(termId)).map((course) => ({
      id: course.id,
      external_course_code: course.externalCourseCode,
      name: course.name,
      credits: course.credits,
    }));
  }

  async listClassSections(courseId: string): Promise<ClassSectionWire[]> {
    return (await this.#repository.listClassSections(courseId)).map(
      (section) => ({
        id: section.id,
        external_section_id: section.externalSectionId,
        section_number: section.sectionNumber,
        department_code: section.departmentCode,
        department_name: section.departmentName,
        instructors: section.instructors,
        campus: section.campus,
        capacity: section.capacity,
        schedule_text: section.scheduleText,
        active: section.active,
        revision: section.revision,
      }),
    );
  }
}
