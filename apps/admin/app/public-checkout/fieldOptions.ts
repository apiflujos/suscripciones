export type FieldPreset = {
  key: string;
  label: string;
  input: "text" | "email" | "tel" | "select" | "textarea";
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
};

export const ID_TYPE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Cédula de ciudadanía (CC)", value: "CC" },
  { label: "Tarjeta de identidad (TI)", value: "TI" },
  { label: "Registro civil (RC)", value: "RC" },
  { label: "Cédula de extranjería (CE)", value: "CE" },
  { label: "Pasaporte", value: "PA" },
  { label: "Permiso Especial de Permanencia / PPT", value: "PPT" },
  { label: "NIT", value: "NIT" }
];

export const DEPARTMENT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Amazonas", value: "Amazonas" },
  { label: "Antioquia", value: "Antioquia" },
  { label: "Arauca", value: "Arauca" },
  { label: "Atlántico", value: "Atlántico" },
  { label: "Bolívar", value: "Bolívar" },
  { label: "Boyacá", value: "Boyacá" },
  { label: "Caldas", value: "Caldas" },
  { label: "Caquetá", value: "Caquetá" },
  { label: "Casanare", value: "Casanare" },
  { label: "Cauca", value: "Cauca" },
  { label: "Cesar", value: "Cesar" },
  { label: "Chocó", value: "Chocó" },
  { label: "Córdoba", value: "Córdoba" },
  { label: "Cundinamarca", value: "Cundinamarca" },
  { label: "Bogotá D.C.", value: "Bogotá D.C." },
  { label: "Guainía", value: "Guainía" },
  { label: "Guaviare", value: "Guaviare" },
  { label: "Huila", value: "Huila" },
  { label: "La Guajira", value: "La Guajira" },
  { label: "Magdalena", value: "Magdalena" },
  { label: "Meta", value: "Meta" },
  { label: "Nariño", value: "Nariño" },
  { label: "Norte de Santander", value: "Norte de Santander" },
  { label: "Putumayo", value: "Putumayo" },
  { label: "Quindío", value: "Quindío" },
  { label: "Risaralda", value: "Risaralda" },
  { label: "San Andrés y Providencia", value: "San Andrés y Providencia" },
  { label: "Santander", value: "Santander" },
  { label: "Sucre", value: "Sucre" },
  { label: "Tolima", value: "Tolima" },
  { label: "Valle del Cauca", value: "Valle del Cauca" },
  { label: "Vaupés", value: "Vaupés" },
  { label: "Vichada", value: "Vichada" }
];

export const FIELD_PRESETS: FieldPreset[] = [
  { key: "firstName", label: "Nombre", input: "text", required: true },
  { key: "lastName", label: "Apellido", input: "text", required: true },
  { key: "email", label: "Email", input: "email", required: true },
  { key: "phone", label: "Teléfono", input: "tel", required: true },
  { key: "address", label: "Dirección", input: "text" },
  { key: "city", label: "Ciudad", input: "text" },
  { key: "department", label: "Departamento", input: "select", options: DEPARTMENT_OPTIONS },
  { key: "idType", label: "Tipo de identificación", input: "select", options: ID_TYPE_OPTIONS },
  { key: "idNumber", label: "Número de identificación", input: "text" },
  { key: "paymentReference", label: "Referencia de pago", input: "text" },
  { key: "notes", label: "Observaciones", input: "textarea" }
];

export const DEFAULT_FIELD_KEYS = FIELD_PRESETS.map((preset) => preset.key);
