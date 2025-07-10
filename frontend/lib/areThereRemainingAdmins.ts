import { db } from "./db.server";
import { user } from "../db/auth-schema";
import { eq, and, ne } from "drizzle-orm";

/**
 * Checks if there are any admin users remaining in the system excluding the specified user ID.
 * This function is used to validate that we're not removing or downgrading the last admin user.
 * 
 * @param userId - The user ID to exclude from the admin count
 * @returns Promise<boolean> - true if there are other admin users remaining, false if this would be the last admin
 */
export async function areThereRemainingAdmins(userId: string): Promise<boolean> {
  try {
    // Query for admin users excluding the specified user ID
    const remainingAdmins = await db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.role, "admin"),
          ne(user.id, userId)
        )
      )
      .limit(1);

    // If we found at least one admin user other than the specified user, return true
    return remainingAdmins.length > 0;
  } catch (error) {
    console.error("Error checking for remaining admins:", error);
    // In case of error, assume there are no remaining admins to be safe
    return false;
  }
}
