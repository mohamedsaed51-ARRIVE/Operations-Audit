import type { Paginated } from '@arrive/shared';
import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function paginate<T>(data: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}
