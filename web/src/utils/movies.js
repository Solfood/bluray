export const moviesMatch = (a, b) => {
  if (!a || !b) return false;
  if (a.added_at && b.added_at && a.added_at === b.added_at) return true;
  if (a.upc && b.upc && a.upc === b.upc && a.title === b.title) return true;
  if (a.id != null && b.id != null && a.id === b.id && a.title === b.title) return true;
  return false;
};
