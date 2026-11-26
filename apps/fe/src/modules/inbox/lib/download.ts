/** Saves an opened report to the device of the person as a JSON file. The report stays in the browser: nothing is sent anywhere. */
export function downloadReport(report: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
