"use client";

import dynamic from "next/dynamic";

const GlobalLoader = dynamic(() => import("./GlobalLoader").then(mod => mod.GlobalLoader), {
  ssr: false
});

const FormValidation = dynamic(() => import("./FormValidation").then(mod => mod.FormValidation), {
  ssr: false
});

export function ClientProviders() {
  return (
    <>
      <GlobalLoader />
      <FormValidation />
    </>
  );
}
