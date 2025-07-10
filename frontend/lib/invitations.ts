import { db } from "./db.server";
import { invitations as invitationTable } from "../db/schema";
import { eq } from "drizzle-orm";

export async function getValidInvitation(invitationId: string) {
    const invitationRows = await db.select().from(invitationTable).where(eq(invitationTable.id, invitationId));
    
    if (invitationRows.length === 0) {
      throw new Error("Invitation not found.");
    }
  
    const invitationRow = invitationRows[0];
  
    if (invitationRow.status !== 'pending') {
      throw new Error("Invitation not found.");
    }
  
    if (invitationRow.expires_at && new Date(invitationRow.expires_at) < new Date()) {
      throw new Error("Invitation has expired.");
    } 
  
    return invitationRow;
  }

export async function acceptInvitation(invitationId: string) {
  await db.update(invitationTable).set({
    status: "accepted"
  }).where(eq(invitationTable.id, invitationId));
}

export async function getPendingInvitations() {
  return await db.select().from(invitationTable).where(eq(invitationTable.status, "pending"));
}