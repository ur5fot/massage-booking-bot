import type { Db } from "../../db/client.js";
import type { Service } from "../../generated/prisma/client.js";

export class ServiceCatalog {
  constructor(private readonly db: Db) {}

  async listEnabled(): Promise<Service[]> {
    return this.db.service.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  /**
   * MVP работает с одной услугой, но модель уже поддерживает несколько,
   * поэтому «услуга по умолчанию» — это первая включённая, а не константа в коде.
   */
  async default(): Promise<Service> {
    const service = await this.db.service.findFirst({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    if (service === null) {
      throw new Error("В базе нет ни одной включённой услуги. Запустите `npm run db:seed`.");
    }

    return service;
  }

  async byId(id: string): Promise<Service | null> {
    return this.db.service.findUnique({ where: { id } });
  }
}
