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
  department: string | null;
}

export interface ClassSectionRecord {
  id: string;
  externalSectionId: string;
  sectionNumber: string;
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

function shanghaiLocalDate(now: Date): string {
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
  return `${year}-${month}-${day}`;
}

export function deriveTermStatus(
  term: Pick<TermRecord, 'startsOn' | 'endsOn' | 'statusOverride'>,
  now: Date,
): TermStatus {
  if (term.statusOverride === 'archived') {
    return 'archived';
  }
  if (term.statusOverride === 'active') {
    return 'in_progress';
  }

  const today = shanghaiLocalDate(now);
  if (term.endsOn !== null && today > term.endsOn) {
    return 'archived';
  }
  if (term.startsOn !== null && today < term.startsOn) {
    return 'upcoming';
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
      department: course.department,
    }));
  }

  async listClassSections(courseId: string): Promise<ClassSectionWire[]> {
    return (await this.#repository.listClassSections(courseId)).map(
      (section) => ({
        id: section.id,
        external_section_id: section.externalSectionId,
        section_number: section.sectionNumber,
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
