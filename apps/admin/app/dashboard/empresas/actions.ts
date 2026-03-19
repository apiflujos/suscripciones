"use server";

import { redirect } from "next/navigation";
import { assertCsrfToken } from "../../lib/csrf";
import { prisma } from "@suscripciones/database";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../lib/session";

type ContactInput = {
  id?: string;
  tempId?: string;
  nombre: string;
  email?: string;
  telefono?: string;
  cargo: string;
};

function safeReturnTo(formData: FormData) {
  const raw = String(formData.get("returnTo") || "").trim();
  return raw.startsWith("/dashboard/empresas") ? raw : "/dashboard/empresas";
}

function toShortErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 220) || "unknown_error";
}

function parseContacts(raw: string): ContactInput[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      id: item?.id ? String(item.id) : undefined,
      tempId: item?.tempId ? String(item.tempId) : undefined,
      nombre: String(item?.nombre || "").trim(),
      email: item?.email ? String(item.email).trim() : "",
      telefono: item?.telefono ? String(item.telefono).trim() : "",
      cargo: String(item?.cargo || "").trim()
    }));
  } catch {
    return [];
  }
}

function assertValidEmail(email?: string) {
  if (!email) return;
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!ok) throw new Error("email_invalido");
}

function normalizeContacts(contacts: ContactInput[]) {
  return contacts
    .map((c) => ({
      ...c,
      nombre: String(c.nombre || "").trim(),
      cargo: String(c.cargo || "").trim(),
      email: c.email ? String(c.email).trim() : "",
      telefono: c.telefono ? String(c.telefono).trim() : ""
    }))
    .filter((c) => c.nombre || c.email || c.telefono || c.cargo);
}

async function resolveSessionTenantId() {
  const c = await cookies();
  const sessionToken = c.get(ADMIN_SESSION_COOKIE)?.value || "";
  const session = await verifyAdminSessionToken(sessionToken);
  return session?.tenantId || null;
}

export async function createEmpresa(formData: FormData) {
  await assertCsrfToken(formData);
  const nombre = String(formData.get("nombre") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const telefono = String(formData.get("telefono") || "").trim();
  const direccion = String(formData.get("direccion") || "").trim();
  const sitioWeb = String(formData.get("sitioWeb") || "").trim();
  const contactsJson = String(formData.get("contactsJson") || "");
  const contactoPrincipalKey = String(formData.get("contactoPrincipalKey") || "").trim();
  const tenantId = String(formData.get("tenantId") || "").trim();
  const returnTo = safeReturnTo(formData);

  if (!nombre) redirect(`${returnTo}?error=nombre_requerido`);
  if (email) {
    try {
      assertValidEmail(email);
    } catch {
      redirect(`${returnTo}?error=email_invalido`);
    }
  }

  const contacts = normalizeContacts(parseContacts(contactsJson));
  for (const contact of contacts) {
    if (!contact.nombre) redirect(`${returnTo}?error=contacto_sin_nombre`);
    if (!contact.cargo) redirect(`${returnTo}?error=contacto_sin_cargo`);
    if (contact.email) {
      try {
        assertValidEmail(contact.email);
      } catch {
        redirect(`${returnTo}?error=contacto_email_invalido`);
      }
    }
  }

  try {
    const resolvedTenantId = tenantId || (await resolveSessionTenantId());
    const result = await prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.create({
        data: {
          nombre,
          email: email || null,
          telefono: telefono || null,
          direccion: direccion || null,
          sitioWeb: sitioWeb || null,
          tenantId: resolvedTenantId || null
        }
      });

      const createdContacts: Array<{ id: string; tempId?: string }> = [];
      for (const c of contacts) {
        const created = await tx.contacto.create({
          data: {
            empresaId: empresa.id,
            nombre: c.nombre,
            cargo: c.cargo,
            email: c.email || null,
            telefono: c.telefono || null
          }
        });
        createdContacts.push({ id: created.id, tempId: c.tempId });
      }

      let principalId: string | null = null;
      if (contactoPrincipalKey) {
        const byTemp = createdContacts.find((c) => c.tempId && c.tempId === contactoPrincipalKey);
        if (byTemp) principalId = byTemp.id;
      }
      if (contactoPrincipalKey && !principalId) {
        throw new Error("contacto_principal_invalido");
      }
      if (principalId) {
        await tx.empresa.update({
          where: { id: empresa.id },
          data: { contactoPrincipalId: principalId }
        });
      }

      return empresa;
    });
    redirect(`/dashboard/empresas/${result.id}?created=1`);
  } catch (err) {
    redirect(`${returnTo}?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function updateEmpresa(formData: FormData) {
  await assertCsrfToken(formData);
  const id = String(formData.get("id") || "").trim();
  const nombre = String(formData.get("nombre") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const telefono = String(formData.get("telefono") || "").trim();
  const direccion = String(formData.get("direccion") || "").trim();
  const sitioWeb = String(formData.get("sitioWeb") || "").trim();
  const contactsJson = String(formData.get("contactsJson") || "");
  const contactoPrincipalKey = String(formData.get("contactoPrincipalKey") || "").trim();
  const returnTo = safeReturnTo(formData);

  if (!id) redirect(`${returnTo}?error=empresa_no_encontrada`);
  if (!nombre) redirect(`${returnTo}?error=nombre_requerido`);
  if (email) {
    try {
      assertValidEmail(email);
    } catch {
      redirect(`${returnTo}?error=email_invalido`);
    }
  }

  const contacts = normalizeContacts(parseContacts(contactsJson));
  for (const contact of contacts) {
    if (!contact.nombre) redirect(`${returnTo}?error=contacto_sin_nombre`);
    if (!contact.cargo) redirect(`${returnTo}?error=contacto_sin_cargo`);
    if (contact.email) {
      try {
        assertValidEmail(contact.email);
      } catch {
        redirect(`${returnTo}?error=contacto_email_invalido`);
      }
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.contacto.findMany({ where: { empresaId: id } });
      const existingIds = new Set(existing.map((c) => c.id));
      const payloadIds = new Set(contacts.map((c) => c.id).filter(Boolean) as string[]);
      const toDelete = existing.filter((c) => !payloadIds.has(c.id));

      if (toDelete.length) {
        await tx.contacto.deleteMany({ where: { id: { in: toDelete.map((c) => c.id) } } });
      }

      for (const c of contacts) {
        if (c.id && existingIds.has(c.id)) {
          await tx.contacto.update({
            where: { id: c.id },
            data: {
              nombre: c.nombre,
              cargo: c.cargo,
              email: c.email || null,
              telefono: c.telefono || null
            }
          });
        }
      }

      const createdContacts: Array<{ id: string; tempId?: string }> = [];
      for (const c of contacts) {
        if (!c.id) {
          const created = await tx.contacto.create({
            data: {
              empresaId: id,
              nombre: c.nombre,
              cargo: c.cargo,
              email: c.email || null,
              telefono: c.telefono || null
            }
          });
          createdContacts.push({ id: created.id, tempId: c.tempId });
        }
      }

      let principalId: string | null = null;
      if (contactoPrincipalKey) {
        if (existingIds.has(contactoPrincipalKey)) {
          principalId = contactoPrincipalKey;
        }
        if (!principalId) {
          const byTemp = createdContacts.find((c) => c.tempId && c.tempId === contactoPrincipalKey);
          if (byTemp) principalId = byTemp.id;
        }
      }
      if (contactoPrincipalKey && !principalId) {
        throw new Error("contacto_principal_invalido");
      }

      await tx.empresa.update({
        where: { id },
        data: {
          nombre,
          email: email || null,
          telefono: telefono || null,
          direccion: direccion || null,
          sitioWeb: sitioWeb || null,
          contactoPrincipalId: principalId || null
        }
      });
    });

    redirect(`/dashboard/empresas/${id}?updated=1`);
  } catch (err) {
    redirect(`/dashboard/empresas/${id}?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}

export async function deleteEmpresa(formData: FormData) {
  await assertCsrfToken(formData);
  const id = String(formData.get("id") || "").trim();
  const returnTo = safeReturnTo(formData);
  if (!id) redirect(`${returnTo}?error=empresa_no_encontrada`);

  try {
    await prisma.empresa.delete({ where: { id } });
    redirect(`${returnTo}?deleted=1`);
  } catch (err) {
    redirect(`${returnTo}?error=${encodeURIComponent(toShortErrorMessage(err))}`);
  }
}
