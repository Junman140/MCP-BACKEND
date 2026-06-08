/** Map Mongo `_id` to `id` for JSON clients that expect Prisma-style `id`. */
export function withId(doc) {
    return { ...doc, id: doc._id };
}
export function withIds(docs) {
    return docs.map(withId);
}
