import { loadConfig } from "./config.js";
import { totpCode } from "./identity.js";

const config = loadConfig();
console.log(totpCode(config.sandboxConsumerTotpSecret));
