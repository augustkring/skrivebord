import { z } from "zod";
import type {
  ConversationContext
} from "@skrivebord/database";

const UuidSchema = z.string().uuid();

export const MojnContextSchema =
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("GENERAL")
    }).strict(),
    z.object({
      type: z.literal("BOOKING"),
      id: UuidSchema
    }).strict(),
    z.object({
      type: z.literal("PROPERTY"),
      id: UuidSchema
    }).strict()
  ]);

export function contextFromRoute(
  route: string
): ConversationContext {
  const path =
    route.split("?")[0] ?? route;
  const segments =
    path
      .split("/")
      .filter(Boolean);

  for (
    let index = 0;
    index < segments.length - 1;
    index += 1
  ) {
    const segment =
      segments[index];
    const candidate =
      segments[index + 1];

    if (
      !candidate ||
      !UuidSchema.safeParse(
        candidate
      ).success
    ) {
      continue;
    }

    if (
      segment === "bookings" ||
      segment === "booking"
    ) {
      return {
        type: "BOOKING",
        id: candidate
      };
    }

    if (
      segment === "properties" ||
      segment === "property"
    ) {
      return {
        type: "PROPERTY",
        id: candidate
      };
    }
  }

  return {
    type: "GENERAL"
  };
}
