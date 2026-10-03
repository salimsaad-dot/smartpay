// mysql2 returns DATE columns as JS Date objects, which JSON.stringify
// serializes as a full ISO datetime ("2026-09-01T00:00:00.000Z") — this
// formats it the way a plain date field should actually read.
export function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatMoney(amount, currencyCode = "GHS") {
  return `${currencyCode} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
