import { allCountries } from "country-telephone-data";

type PhoneCountry = {
  name: string;
  iso2: string;
  dialCode: string;
  label: string;
  flag: string;
};

function isoToFlag(iso2: string) {
  return iso2
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

const rawCountries = allCountries
  .map((entry) => {
    const [name, iso2, dialCode] = entry as [string, string, string];
    return {
      name,
      iso2,
      dialCode,
      label: `${isoToFlag(iso2)} +${dialCode} · ${name}`,
      flag: isoToFlag(iso2)
    };
  })
  .filter((c) => c.iso2 && c.dialCode);

const preferred = ["co", "us", "mx", "es", "ar", "cl", "pe", "ec", "pa", "ve"];

const preferredCountries = rawCountries.filter((c) => preferred.includes(c.iso2));
const otherCountries = rawCountries.filter((c) => !preferred.includes(c.iso2));

export const PHONE_COUNTRIES: PhoneCountry[] = [
  ...preferredCountries,
  ...otherCountries.sort((a, b) => a.name.localeCompare(b.name))
];
