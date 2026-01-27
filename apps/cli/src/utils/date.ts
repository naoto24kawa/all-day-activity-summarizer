export function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getDateString(dateArg?: string): string {
  if (!dateArg || dateArg === "today") {
    return getTodayDateString();
  }
  return dateArg;
}
