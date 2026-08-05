const OPENAPI_CONTRACT = require('./goodieai-marketing-ad-read.openapi.json');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const MARKETING_AD_READ_CONTRACT = deepFreeze(
  structuredClone(OPENAPI_CONTRACT['x-runtime-contract'])
);

module.exports = {
  MARKETING_AD_READ_CONTRACT
};
