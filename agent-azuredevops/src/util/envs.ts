const { AZDO_ORGANIZATION, PORT, HOST } = process.env;

export const envs = {
  AZDO_ORGANIZATION: AZDO_ORGANIZATION?.trim() || "grupodistelsa",
  PORT: Number(PORT ?? 8787),
  HOST: HOST || "127.0.0.1",
};
