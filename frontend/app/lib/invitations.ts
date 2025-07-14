import { db } from "./db.server";
import { invitations as invitationTable } from "~/db/schema";
import { eq } from "drizzle-orm";
import { addEmail } from "./email";

export async function getInvitation(invitationId: string) {
  const invitationRows = await db.select().from(invitationTable).where(eq(invitationTable.id, invitationId));
  return invitationRows[0];
}

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

export async function cancelInvitation(invitationId: string) {
  await db.delete(invitationTable).where(eq(invitationTable.id, invitationId));
}

export async function createInvitation(email: string, role: string, invitedById: string) {
  // Validate email correctness
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    throw new Error("Please enter a valid email address.");
  }

  // Validate role
  if (role !== "admin" && role !== "user") {
    throw new Error("Incorrect role.");
  }

  // Check if user already exists
  const existingUser = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, email),
  });

  if (existingUser) {
    throw new Error("A user with this email already exists.");
  }

  // Check if invitation already exists
  const existingInvitation = await db.query.invitations.findFirst({
    where: (i, { eq }) => eq(i.email, email),
  });
  
  if (existingInvitation) {
    throw new Error("An invitation with this email already exists.");
  }


  const newId = crypto.randomUUID();

  await db.insert(invitationTable).values({
    id: newId,
    email,
    role,
    invited_by: invitedById,
    status: "pending",
    created_at: new Date(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
  }).returning();

  await addEmail({
    to: email,
    subject: "You're Invited to Join AgentView!",
    text: `Hello,

You've been invited to join the AgentView project as a ${role}.

To accept your invitation and create your account, please click the link below:
${process.env.ROOT_URL}/signup?invitationId=${newId}

If you did not expect this invitation, you can safely ignore this email.

Best regards,
The AgentView Team
`,
    html: `<p>Hello,</p>
<p>You've been invited to join the <strong>AgentView</strong> project as a <strong>${role}</strong>.</p>
<p>To accept your invitation and create your account, please click the link below:</p>
<p><a href="${process.env.ROOT_URL}/signup?invitationId=${newId}">Accept Invitation</a></p>
<p>If you did not expect this invitation, you can safely ignore this email.</p>
<p>Best regards,<br/>The AgentView Team</p>`
  }, invitedById);
}