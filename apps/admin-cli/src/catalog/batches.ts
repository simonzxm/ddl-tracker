import type { CatalogPlanBatchRequest } from '@ddl-tracker/contracts';

export interface CatalogBatch {
  courses: CatalogPlanBatchRequest['courses'];
  class_sections: CatalogPlanBatchRequest['class_sections'];
}

function encodedBytes(batch: CatalogBatch): number {
  return new TextEncoder().encode(JSON.stringify(batch)).byteLength;
}

export function splitCatalogBatches(
  courses: CatalogPlanBatchRequest['courses'],
  classSections: CatalogPlanBatchRequest['class_sections'],
  options: {
    maximumRecordsPerType: number;
    maximumPayloadBytes: number;
  },
): CatalogBatch[] {
  if (
    !Number.isInteger(options.maximumRecordsPerType) ||
    options.maximumRecordsPerType < 1 ||
    !Number.isInteger(options.maximumPayloadBytes) ||
    options.maximumPayloadBytes < 1
  ) {
    throw new Error('Catalog batch limits must be positive integers.');
  }

  if (courses.length === 0 && classSections.length === 0) {
    return [{ courses: [], class_sections: [] }];
  }

  const batches: CatalogBatch[] = [];
  let courseIndex = 0;
  let sectionIndex = 0;

  while (courseIndex < courses.length || sectionIndex < classSections.length) {
    const batch: CatalogBatch = { courses: [], class_sections: [] };
    let madeProgress = true;

    while (madeProgress) {
      madeProgress = false;
      const nextCourse = courses[courseIndex];
      if (
        nextCourse !== undefined &&
        batch.courses.length < options.maximumRecordsPerType
      ) {
        const candidate = {
          courses: [...batch.courses, nextCourse],
          class_sections: batch.class_sections,
        };
        if (encodedBytes(candidate) <= options.maximumPayloadBytes) {
          batch.courses.push(nextCourse);
          courseIndex += 1;
          madeProgress = true;
        }
      }

      const nextSection = classSections[sectionIndex];
      if (
        nextSection !== undefined &&
        batch.class_sections.length < options.maximumRecordsPerType
      ) {
        const candidate = {
          courses: batch.courses,
          class_sections: [...batch.class_sections, nextSection],
        };
        if (encodedBytes(candidate) <= options.maximumPayloadBytes) {
          batch.class_sections.push(nextSection);
          sectionIndex += 1;
          madeProgress = true;
        }
      }
    }

    if (batch.courses.length === 0 && batch.class_sections.length === 0) {
      throw new Error(
        'A single catalog record exceeds the configured request byte budget.',
      );
    }
    batches.push(batch);
  }

  return batches;
}
