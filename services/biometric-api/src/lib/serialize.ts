/** Map Mongo `_id` to `id` for JSON clients that expect Prisma-style `id`. */
export function withId<T extends { _id: string }>(doc: T): T & { id: string } {
  return { ...doc, id: doc._id };
}

export function withIds<T extends { _id: string }>(docs: T[]): Array<T & { id: string }> {
  return docs.map(withId);
}
