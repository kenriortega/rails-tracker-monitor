// The persistent consumer is not implemented yet; diagnose.ts provides a bounded live check.
const configured = Boolean(process.env.NETWORK_RAIL_USERNAME && process.env.NETWORK_RAIL_PASSWORD);
console.info(JSON.stringify({mode: "not-connected", credentialsPresent: configured, nextStep: "Run npm run diagnose:network-rail from the project root to check live access."}));
