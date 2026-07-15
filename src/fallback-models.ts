import type { NovitaModel } from "./novita-api.js";

// Snapshot of Novita's recommended models (novita.ai/docs/guides/llm-recommended)
// taken from the live /v1/models response on 2026-07-15. Used only when the
// endpoint is unreachable at startup, so the provider still registers with
// accurate metadata and pricing.
export const FALLBACK_MODELS: NovitaModel[] = [
  {
    "id": "tencent/hy3",
    "display_name": "Hy3",
    "context_size": 262144,
    "max_output_tokens": 262144,
    "features": [
      "serverless",
      "function-calling",
      "structured-outputs",
      "reasoning"
    ],
    "input_modalities": [
      "text"
    ],
    "input_token_price_per_m": 0,
    "output_token_price_per_m": 0
  },
  {
    "id": "moonshotai/kimi-k2.7-code",
    "display_name": "Kimi K2.7 Code",
    "context_size": 262144,
    "max_output_tokens": 262144,
    "features": [
      "serverless",
      "function-calling",
      "structured-outputs",
      "reasoning"
    ],
    "input_modalities": [
      "text",
      "image"
    ],
    "input_token_price_per_m": 9500,
    "output_token_price_per_m": 40000,
    "pricing": {
      "prompt": {
        "price_per_m": 9500
      },
      "completion": {
        "price_per_m": 40000
      },
      "input_cache_read": {
        "price_per_m": 1900
      }
    }
  },
  {
    "id": "zai-org/glm-5.2",
    "display_name": "GLM 5.2",
    "context_size": 1048576,
    "max_output_tokens": 131072,
    "features": [
      "function-calling",
      "structured-outputs",
      "reasoning",
      "serverless"
    ],
    "input_modalities": [
      "text"
    ],
    "input_token_price_per_m": 14000,
    "output_token_price_per_m": 44000,
    "pricing": {
      "prompt": {
        "price_per_m": 14000
      },
      "completion": {
        "price_per_m": 44000
      },
      "input_cache_read": {
        "price_per_m": 2600
      }
    }
  },
  {
    "id": "deepseek/deepseek-v4-pro",
    "display_name": "Deepseek V4 Pro",
    "context_size": 1048576,
    "max_output_tokens": 393216,
    "features": [
      "serverless",
      "function-calling",
      "structured-outputs",
      "reasoning"
    ],
    "input_modalities": [
      "text"
    ],
    "input_token_price_per_m": 16000,
    "output_token_price_per_m": 32000,
    "pricing": {
      "prompt": {
        "price_per_m": 16000
      },
      "completion": {
        "price_per_m": 32000
      },
      "input_cache_read": {
        "price_per_m": 1350
      }
    }
  },
  {
    "id": "deepseek/deepseek-v3.2",
    "display_name": "Deepseek V3.2",
    "context_size": 163840,
    "max_output_tokens": 65536,
    "features": [
      "function-calling",
      "structured-outputs",
      "reasoning",
      "serverless"
    ],
    "input_modalities": [
      "text"
    ],
    "input_token_price_per_m": 2690,
    "output_token_price_per_m": 4000,
    "pricing": {
      "prompt": {
        "price_per_m": 2690
      },
      "completion": {
        "price_per_m": 4000
      },
      "input_cache_read": {
        "price_per_m": 1345
      }
    }
  },
  {
    "id": "qwen/qwen3.5-397b-a17b",
    "display_name": "Qwen3.5-397B-A17B",
    "context_size": 262144,
    "max_output_tokens": 65536,
    "features": [
      "serverless",
      "function-calling",
      "structured-outputs",
      "reasoning"
    ],
    "input_modalities": [
      "text",
      "image"
    ],
    "input_token_price_per_m": 6000,
    "output_token_price_per_m": 36000,
    "pricing": {
      "prompt": {
        "price_per_m": 6000
      },
      "completion": {
        "price_per_m": 36000
      }
    }
  },
  {
    "id": "minimax/minimax-m3",
    "display_name": "MiniMax M3",
    "context_size": 1000000,
    "max_output_tokens": 131072,
    "features": [
      "serverless",
      "function-calling",
      "structured-outputs",
      "reasoning"
    ],
    "input_modalities": [
      "text",
      "image"
    ],
    "input_token_price_per_m": 3000,
    "output_token_price_per_m": 12000,
    "pricing": {
      "prompt": {
        "price_per_m": 3000
      },
      "completion": {
        "price_per_m": 12000
      },
      "input_cache_read": {
        "price_per_m": 600
      }
    },
    "tiered_billing_configs": [
      {
        "min_tokens": 1,
        "max_tokens": 524288,
        "pricing": {
          "prompt": {
            "price_per_m": 3000
          },
          "completion": {
            "price_per_m": 12000
          },
          "input_cache_read": {
            "price_per_m": 600
          }
        }
      },
      {
        "min_tokens": 524288,
        "max_tokens": 1000000,
        "pricing": {
          "prompt": {
            "price_per_m": 6000
          },
          "completion": {
            "price_per_m": 24000
          },
          "input_cache_read": {
            "price_per_m": 1200
          }
        }
      }
    ]
  },
  {
    "id": "deepseek/deepseek-v4-flash",
    "display_name": "Deepseek V4 Flash",
    "context_size": 1048576,
    "max_output_tokens": 393216,
    "features": [
      "serverless",
      "function-calling",
      "structured-outputs",
      "reasoning"
    ],
    "input_modalities": [
      "text"
    ],
    "input_token_price_per_m": 1400,
    "output_token_price_per_m": 2800,
    "pricing": {
      "prompt": {
        "price_per_m": 1400
      },
      "completion": {
        "price_per_m": 2800
      },
      "input_cache_read": {
        "price_per_m": 280
      }
    }
  },
  {
    "id": "moonshotai/kimi-k2.5",
    "display_name": "Kimi K2.5",
    "context_size": 262144,
    "max_output_tokens": 262144,
    "features": [
      "serverless",
      "reasoning",
      "structured-outputs",
      "function-calling"
    ],
    "input_modalities": [
      "text",
      "image"
    ],
    "input_token_price_per_m": 6000,
    "output_token_price_per_m": 30000,
    "pricing": {
      "prompt": {
        "price_per_m": 6000
      },
      "completion": {
        "price_per_m": 30000
      },
      "input_cache_read": {
        "price_per_m": 1000
      }
    }
  },
  {
    "id": "google/gemma-4-31b-it",
    "display_name": "Gemma 4 31B",
    "context_size": 262144,
    "max_output_tokens": 131072,
    "features": [
      "serverless",
      "structured-outputs",
      "function-calling",
      "reasoning"
    ],
    "input_modalities": [
      "text",
      "image"
    ],
    "input_token_price_per_m": 1400,
    "output_token_price_per_m": 4000,
    "pricing": {
      "prompt": {
        "price_per_m": 1400
      },
      "completion": {
        "price_per_m": 4000
      }
    }
  },
  {
    "id": "inclusionai/ling-2.6-flash",
    "display_name": "Ling-2.6-flash",
    "context_size": 262144,
    "max_output_tokens": 32768,
    "features": [
      "serverless",
      "function-calling",
      "structured-outputs"
    ],
    "input_modalities": [
      "text"
    ],
    "input_token_price_per_m": 1000,
    "output_token_price_per_m": 3000,
    "pricing": {
      "prompt": {
        "price_per_m": 1000
      },
      "completion": {
        "price_per_m": 3000
      },
      "input_cache_read": {
        "price_per_m": 200
      }
    }
  },
  {
    "id": "meta-llama/llama-3.1-8b-instruct",
    "display_name": "Llama 3.1 8B Instruct",
    "context_size": 16384,
    "max_output_tokens": 16384,
    "features": [
      "structured-outputs",
      "serverless"
    ],
    "input_modalities": [
      "text"
    ],
    "input_token_price_per_m": 200,
    "output_token_price_per_m": 500,
    "pricing": {
      "prompt": {
        "price_per_m": 200
      },
      "completion": {
        "price_per_m": 500
      }
    }
  },
  {
    "id": "google/gemma-4-26b-a4b-it",
    "display_name": "Gemma 4 26B A4B",
    "context_size": 262144,
    "max_output_tokens": 131072,
    "features": [
      "serverless",
      "structured-outputs",
      "function-calling",
      "reasoning"
    ],
    "input_modalities": [
      "text",
      "image"
    ],
    "input_token_price_per_m": 1300,
    "output_token_price_per_m": 4000,
    "pricing": {
      "prompt": {
        "price_per_m": 1300
      },
      "completion": {
        "price_per_m": 4000
      }
    }
  }
];
