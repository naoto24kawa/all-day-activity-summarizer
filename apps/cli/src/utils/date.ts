export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDateString(dateArg?: string): string {
  if (!dateArg || dateArg === "today") {
    return getTodayDateString();
  }
  return dateArg;
}
