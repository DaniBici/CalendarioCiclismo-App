-- Validación posterior a la limpieza global de licencias UCI.
-- La operación uci-license-contract-20260830 debe haber retirado antes todos los
-- valores históricos que no tienen exactamente 11 cifras.

ALTER TABLE public.riders_men
  VALIDATE CONSTRAINT riders_men_uci_license_11_check;

ALTER TABLE public.riders_women
  VALIDATE CONSTRAINT riders_women_uci_license_11_check;
