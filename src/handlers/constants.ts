export const REQUEST_PROCESSING = {
  DEFAULT_WEIGHT: 1,
  GATEWAY_EXCEPTION_HEADER: 'x-portkey-gateway-exception',
  HEADERS_TO_AVOID_CLOUDFLARE: ['expect'],
  BROTLI_ENCODING: 'br',
  DEFAULT_CONTENT_TYPE: 'application/json',
  POWERED_BY_HEADER_PREFIX: 'x-portkey-',
  HOOK_ID_SUFFIX_LENGTH: 5,
} as const;

export const ERROR_MESSAGES = {
  NO_PROVIDER_SELECTED: 'No provider selected, please check the weights',
  SOMETHING_WENT_WRONG: 'Something went wrong',
  ALL_RETRY_ATTEMPTS_FAILED: 'All retry attempts exhausted without success',
  HOOKS_FAILED: 'The guardrail checks defined in the config failed. You can find more information in the `hook_results` object.',
} as const;

export const HTTP_STATUS = {
  HOOKS_FAILED: 446,
  INTERNAL_SERVER_ERROR: 500,
  BAD_REQUEST: 400,
  SUCCESS: 200,
} as const;

export const HOOK_PROPERTIES = {
  EXTRACTABLE_KEYS: [
    'deny',
    'on_fail', 
    'on_success',
    'async',
    'id',
    'type',
    'guardrail_version_id',
  ],
  DEFAULT_PLUGIN_PREFIX: 'default.',
} as const;

export const CACHE_CONFIG = {
  DEFAULT_MODE: 'simple',
  HIT_STATUS: 'hit',
  MISS_STATUS: 'miss',
} as const;

export const STRATEGY_CONFIG = {
  SINGLE_TARGET_INDEX: 0,
  RETRY_ATTEMPT_EXHAUSTED: -1,
} as const;