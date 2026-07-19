#!/usr/bin/env node

import { AdminApiError } from './api-client.js';
import { createProgram } from './cli.js';

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  if (error instanceof AdminApiError) {
    console.error(
      `${error.code}: ${error.message} (request ${error.requestId})`,
    );
  } else {
    console.error(error instanceof Error ? error.message : 'Admin CLI failed.');
  }
  process.exitCode = 1;
}
