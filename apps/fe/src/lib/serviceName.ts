import type { Business } from "@/lib/schemas";

/** The name of a service of a business, or a numbered fallback for an id the business does not list. */
export const serviceName = (business: Pick<Business, "services">, serviceId: number): string =>
  business.services.find((s) => s.id === serviceId)?.name ?? `Service ${serviceId}`;