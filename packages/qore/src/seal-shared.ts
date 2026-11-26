// The light part of sealing: constants and the error a page needs to show. It imports nothing, so a page can use it
// without loading the post-quantum seal code in ./seal.ts.
export const REQUEST_PURPOSE = "qredit/request/v1";
export const REPORT_PURPOSE = "qredit/report/v1";
export const MAX_INPUT = 2000;

export class ReportUnreadable extends Error {}
