**Backend changes**

These are the concrete backend pieces that specifically involve A4F or were clearly added/used to support a custom OpenAI‑compatible endpoint like A4F.

1. **Custom endpoint config lookup (A4F by name)**  
   File: [config.ts](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/packages/api/src/app/config.ts#L54-L73)  
   Test: [config.spec.ts](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/packages/api/src/app/config.spec.ts#L13-L51)

   - `getCustomEndpointConfig`:
     - Accepts `{ endpoint, appConfig }` and looks up the endpoint under `appConfig.endpoints[EModelEndpoint.custom]`.
     - Normalizes the endpoint name using `normalizeEndpointName` and compares in lowercase:
       ```ts
       const normalizedEndpoint = normalizeEndpointName(String(endpoint)).toLowerCase();
       ...
       return customEndpoints.find((endpointConfig) => {
         const name = endpointConfig.name ?? '';
         return normalizeEndpointName(name).toLowerCase() === normalizedEndpoint;
       });
       ```
     - If `appConfig` is missing, it throws:
       ```ts
       throw new Error(`Config not found for the ${endpoint} custom endpoint.`);
       ```
   - A4F‑specific tests:
     - The spec constructs an `AppConfig` containing a custom endpoint with `name: 'A4F'` and then calls:
       ```ts
       getCustomEndpointConfig({ endpoint: 'a4f', appConfig })
       ```
       and asserts the result is found and has `name === 'A4F'`.  
       This verifies that using “A4F” in config and “a4f” in the request still matches.
     - Another test verifies the error message when `appConfig` is missing:
       ```ts
       getCustomEndpointConfig({ endpoint: 'A4F', appConfig: undefined })
       // throws 'Config not found for the A4F custom endpoint.'
       ```

   **Effect for A4F:** Any request that uses the custom endpoint with name `A4F` (case‑insensitive) will resolve to the A4F config block from `librechat.yaml`. This is the first step in making A4F work as a custom endpoint.

2. **Custom endpoint initialization pipeline (A4F example)**  
   Implementation: [initialize.ts](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/packages/api/src/endpoints/custom/initialize.ts#L62-L180)  
   Tests: [initialize.spec.ts](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/packages/api/src/endpoints/custom/initialize.spec.ts#L28-L257)

   The `initializeCustom` function is the backend entry point for all custom endpoints, including A4F.

   Key behavior relevant to A4F:

   - **Fetches the custom endpoint config (A4F)**:
     ```ts
     const endpointConfig = getCustomEndpointConfig({
       endpoint,
       appConfig,
     });
     if (!endpointConfig) {
       throw new Error(`Config not found for the ${endpoint} custom endpoint.`);
     }
     ```
     For A4F, `endpointConfig` is the YAML block with `name: 'A4F'`, `apiKey`, `baseURL`, `models`, etc.

   - **Resolves env placeholders for A4F API key and base URL**:
     ```ts
     const CUSTOM_API_KEY = extractEnvVariable(endpointConfig.apiKey ?? '');
     const CUSTOM_BASE_URL = extractEnvVariable(endpointConfig.baseURL ?? '');
     if (CUSTOM_API_KEY.match(envVarRegex)) {
       throw new Error(`Missing API Key for ${endpoint}.`);
     }
     if (CUSTOM_BASE_URL.match(envVarRegex)) {
       throw new Error(`Missing Base URL for ${endpoint}.`);
     }
     ```
     So if YAML uses `${A4F_API_KEY}` but the env var is not set, an error is thrown explicitly for A4F.

   - **Supports “user_provided” API key / URL for custom endpoints**:
     ```ts
     const userProvidesKey = isUserProvided(CUSTOM_API_KEY);
     const userProvidesURL = isUserProvided(CUSTOM_BASE_URL);

     let userValues = null;
     if (expiresAt && (userProvidesKey || userProvidesURL)) {
       checkUserKeyExpiry(expiresAt, endpoint);
       userValues = await db.getUserKeyValues({ userId: req.user?.id ?? '', name: endpoint });
     }

     const apiKey = userProvidesKey ? userValues?.apiKey : CUSTOM_API_KEY;
     const baseURL = userProvidesURL ? userValues?.baseURL : CUSTOM_BASE_URL;
     ```
     - If A4F were configured with `apiKey: 'user_provided'` or `baseURL: 'user_provided'`, it would:
       - Validate the expiry time (`checkUserKeyExpiry`).
       - Load per‑user stored values from the DB.
       - Use those as `apiKey` / `baseURL`.

   - **Error handling for missing user‑provided values**:
     ```ts
     if (userProvidesKey && !apiKey) {
       throw new Error(JSON.stringify({ type: ErrorTypes.NO_USER_KEY }));
     }
     if (userProvidesURL && !baseURL) {
       throw new Error(JSON.stringify({ type: ErrorTypes.NO_BASE_URL }));
     }
     if (!apiKey) {
       throw new Error(`${endpoint} API key not provided.`);
     }
     if (!baseURL) {
       throw new Error(`${endpoint} Base URL not provided.`);
     }
     ```

   - **Token config cache and model fetching support** (used when `models.fetch: true` in YAML, which A4F uses):
     ```ts
     const cache = standardCache(CacheKeys.TOKEN_CONFIG);
     const hasTokenConfig = (endpointConfig as Record<string, unknown>).tokenConfig != null;
     const tokenKey =
       !hasTokenConfig && (userProvidesKey || userProvidesURL) ? `${endpoint}:${userId}` : endpoint;

     const cachedConfig =
       !hasTokenConfig &&
       FetchTokenConfig[endpoint.toLowerCase() as keyof typeof FetchTokenConfig] &&
       (await cache.get(tokenKey));

     if (
       FetchTokenConfig[endpoint.toLowerCase() as keyof typeof FetchTokenConfig] &&
       endpointConfig &&
       endpointConfig.models?.fetch &&
       !endpointTokenConfig
     ) {
       await fetchModels({ apiKey, baseURL, name: endpoint, user: userId, tokenKey });
       endpointTokenConfig = (await cache.get(tokenKey)) as EndpointTokenConfig | undefined;
     }
     ```
     If A4F gets an entry in `FetchTokenConfig`, this logic will fetch the available models using A4F’s OpenAI‑compatible API and cache token information.

   - **Builds OpenAI client options using A4F base URL**:
     ```ts
     const clientOptions: Record<string, unknown> = {
       reverseProxyUrl: baseURL ?? null,
       proxy: PROXY ?? null,
       ...customOptions,
     };
     const modelOptions = { ...(model_parameters ?? {}), user: userId };
     const finalClientOptions = { modelOptions, ...clientOptions };
     const options = getOpenAIConfig(apiKey, finalClientOptions, endpoint);
     if (options != null) {
       (options as InitializeResultBase).useLegacyContent = true;
       (options as InitializeResultBase).endpointTokenConfig = endpointTokenConfig;
     }
     ```
     For A4F, `baseURL` is `https://api.a4f.co/v1`, so the `getOpenAIConfig` call is effectively using A4F as an OpenAI‑compatible backend.

   - **A4F‑specific tests** show the intended behavior:
     - **Happy path**: [initialize.spec.ts](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/packages/api/src/endpoints/custom/initialize.spec.ts#L64-L115)
       - Uses `endpoint = 'A4F'`, `apiKey = 'sk-a4f-key'`, `baseURL = 'https://api.a4f.co/v1'`.
       - Mocks `getCustomEndpointConfig` and `getOpenAIConfig`.
       - Asserts:
         - `getCustomEndpointConfig` is called with `{ endpoint: 'A4F', appConfig: params.req.config }`.
         - `getOpenAIConfig` is called with:
           - `calledApiKey === 'sk-a4f-key'`
           - `calledEndpoint === 'A4F'`
           - `calledOptions.reverseProxyUrl === 'https://api.a4f.co/v1'`
           - `calledOptions.modelOptions.model === 'provider-1/chatgpt-4o-latest'`
         - The resulting `llmConfig` has `model = 'provider-1/chatgpt-4o-latest'` and `streaming = true`.
         - `result.useLegacyContent === true`.
     - **Config error tests**:
       - When `apiKey: '${A4F_API_KEY}'` and env is missing → throws `Missing API Key for A4F.`.
       - When `baseURL: '${A4F_BASE_URL}'` and env is missing → throws `Missing Base URL for A4F.`.
     - **User‑provided key / URL tests**:
       - When A4F requires a user‑provided key but none exists in DB → throws a `NO_USER_KEY` error.
       - When A4F requires a user‑provided URL but none exists → throws a `NO_BASE_URL` error.
       - When `checkUserKeyExpiry` fails → propagates the “User key expired” error.

   **Effect for A4F:** This function is what actually wires an A4F custom endpoint into the existing OpenAI‑style client, including error handling for missing configuration and optional per‑user key/URL support.

3. **Backwards‑compatibility test for A4F’s OpenAI‑compatible base URL**  
   File: [config.backward-compat.spec.ts](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/packages/api/src/endpoints/openai/config.backward-compat.spec.ts#L100-L131)

   This test exercises `getOpenAIConfig` directly for the A4F case:

   - Setup:
     ```ts
     const apiKey = 'sk-a4f-key';
     const endpoint = 'A4F';
     const options = {
       modelOptions: {
         model: 'provider-1/chatgpt-4o-latest',
         user: 'some-user',
       },
       reverseProxyUrl: 'https://api.a4f.co/v1',
       proxy: '',
     };
     ```
   - It expects:
     ```ts
     {
       llmConfig: {
         streaming: true,
         model: 'provider-1/chatgpt-4o-latest',
         user: 'some-user',
         apiKey: 'sk-a4f-key',
       },
       configOptions: {
         baseURL: 'https://api.a4f.co/v1',
       },
       tools: [],
     }
     ```
     and also:
     ```ts
     expect(result.provider).toBeUndefined();
     expect(result.configOptions?.defaultHeaders).toBeUndefined();
     ```
   - This confirms:
     - A4F is treated as a plain OpenAI‑compatible backend, not OpenRouter or Vercel (i.e., no special headers like `HTTP-Referer`, `X-Title`).
     - `baseURL` is set exactly to the A4F URL.

   **Effect for A4F:** Guarantees that A4F works as a “normal” OpenAI‑compatible endpoint with no extra provider-specific headers injected.

4. **Custom endpoints metadata loading (affects A4F)**  
   File: [custom/config.ts](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/packages/api/src/endpoints/custom/config.ts#L10-L55)

   - `loadCustomEndpointsConfig` turns `endpoints.custom` from `librechat.yaml` into the `endpointsConfig` object used by both backend and frontend.
   - For each custom endpoint (including A4F):
     - It requires `baseURL`, `apiKey`, `name`, `models`, and `(models.fetch || models.default)`.
     - It resolves env vars:
       ```ts
       const resolvedApiKey = extractEnvVariable(apiKey ?? '');
       const resolvedBaseURL = extractEnvVariable(baseURL ?? '');
       ```
     - It stores:
       ```ts
       customEndpointsConfig[name] = {
         type: EModelEndpoint.custom,
         userProvide: isUserProvided(resolvedApiKey),
         userProvideURL: isUserProvided(resolvedBaseURL),
         customParams,
         modelDisplayLabel,
         iconURL,
       };
       ```
   **Effect for A4F:** This makes the A4F YAML config available everywhere as a normalized, typed endpoint: its `userProvide` flags and `modelDisplayLabel: 'A4F'` are consumed by the UI and other logic.

---

**Config / environment additions (for A4F)**

1. **Environment variable example**  
   File: [.env.example](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/.env.example#L103-L119)

   - Added a placeholder:
     ```env
     # A4F_API_KEY=
     ```
   - Listed under “Known Endpoints – librechat.yaml”, together with other provider keys.
   - This is what the YAML’s `apiKey: '${A4F_API_KEY}'` refers to.

2. **Sample A4F custom endpoint configuration**  
   File: [librechat.example.yaml](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/librechat.example.yaml#L446-L457)

   Under `endpoints.custom`:

   ```yaml
   - name: 'A4F'
     apiKey: '${A4F_API_KEY}'
     baseURL: 'https://api.a4f.co/v1'
     models:
       default:
         - 'provider-1/chatgpt-4o-latest'
         - 'provider-3/claude-3-5-sonnet-20240620'
       fetch: true
     titleConvo: true
     titleModel: 'provider-1/chatgpt-4o-latest'
     modelDisplayLabel: 'A4F'
   ```

   **Effect:**  
   - Tells LibreChat that A4F is a custom endpoint with an OpenAI‑compatible base URL.
   - `models.fetch: true` allows server-side model fetching (if configured).
   - `modelDisplayLabel: 'A4F'` controls how it appears in the UI.

3. **Documentation in README**  
   File: [README.md](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/README.md#L138-L163)

   The “A4F (OpenAI-compatible) Integration” section describes:

   - Set `A4F_API_KEY`:
     ```bash
     A4F_API_KEY=your_a4f_api_key
     ```
   - Add the same YAML block as above under `endpoints.custom`.
   - Then restart LibreChat and select the `A4F` endpoint in the UI.

   **Effect:** This is purely documentation, but it reflects the actual wiring used by the code.

---

**Frontend behavior**

There is no A4F‑specific React code; A4F uses the existing generic “custom endpoints” support. The relevant frontend code paths that make A4F visible and usable are:

1. **Endpoint selector (shows “A4F” in the UI)**  
   File: [useEndpoints.ts](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/client/src/hooks/Endpoint/useEndpoints.ts#L57-L182)

   - This hook builds the list of endpoints for the model selector based on `endpointsConfig`, which includes the A4F entry loaded from YAML.
   - Important lines:
     ```ts
     const displayLabel =
       getEndpointField(endpointsConfig, ep, 'modelDisplayLabel') || alternateName[ep] || ep;
     ```
   - For A4F:
     - `endpointsConfig` (from backend config loading) carries `modelDisplayLabel: 'A4F'`.
     - So the dropdown label for the A4F endpoint is exactly `'A4F'`.

   - It also uses:
     ```ts
     const endpointRequiresUserKey = (ep: string) =>
       !!getEndpointField(endpointsConfig, ep, 'userProvide');
     ```
     For A4F with an env‑based key (`apiKey: '${A4F_API_KEY}'`), `userProvide` is `false`. So the UI will not prompt the user for a personal API key; it relies on the server’s environment key.

2. **Dual message display and A4F label usage**  
   File: [messages.ts](file:///Users/Nikhil-S/Projects/libreChat/LibreChat/client/src/utils/messages.ts#L194-L287)

   - `createDualMessageContent` constructs the content metadata used when you run side‑by‑side conversations (comparison mode).
   - For endpoints like A4F, it uses `endpointsConfig[endpoint].modelDisplayLabel` as part of the “sender” label for ephemeral agents:
     ```ts
     const primarySender =
       primaryConvo.modelLabel ??
       primarySpec?.label ??
       (primaryEndpoint ? endpointsConfig?.[primaryEndpoint]?.modelDisplayLabel : undefined) ??
       '';
     ```
     Likewise for `addedSender` (for the added conversation).
   - So if you run one conversation via A4F and another via some other endpoint, the A4F conversation will be labeled using `modelDisplayLabel: 'A4F'`.

3. **No A4F‑specific conditionals in frontend code**

   - A search for “A4F” in frontend code (client and packages/client) returns no React/TSX usage.
   - All of A4F’s visibility and behavior comes from:
     - The generic custom endpoints system.
     - `endpointsConfig` (populated by the backend config loader from YAML).
     - Generic properties like `modelDisplayLabel` and `userProvide`.

   **Effect for A4F:** The UI treats A4F as just another custom endpoint; because the backend exposes it via `endpointsConfig` with a label and configuration, it appears in the model selector and in conversation labels automatically.

---

**In short**

- **Backend**:
  - Added/used a generic custom endpoint config resolver (`getCustomEndpointConfig`) with tests that explicitly cover `A4F`.
  - Implemented or extended `initializeCustom` to:
    - Resolve A4F’s `apiKey` and `baseURL` from env/YAML.
    - Handle user‑provided keys/URLs with proper error codes.
    - Pass A4F’s OpenAI‑compatible base URL into `getOpenAIConfig`.
  - Added a backward‑compat test to confirm `getOpenAIConfig` works correctly with `endpoint='A4F'` and `baseURL='https://api.a4f.co/v1'`.

- **Config / docs**:
  - Added `A4F_API_KEY` to `.env.example`.
  - Added an `A4F` block under `endpoints.custom` in `librechat.example.yaml` with baseURL and default models.
  - Documented A4F integration in the README with exact steps.

- **Frontend**:
  - No A4F‑specific React code was added.
  - Existing generic endpoint UI uses:
    - `modelDisplayLabel: 'A4F'` from `endpointsConfig` to label the endpoint and ephemeral agents.
    - `userProvide` flags from `endpointsConfig` to decide whether to prompt users for keys. For the default A4F config (env‑based key), no extra UI is needed.

If you’d like, I can also generate a concise diff-style summary per file (e.g., what each added/changed block does) to paste into a PR description.