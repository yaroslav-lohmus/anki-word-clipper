const { buildAiRequest, parseAiResponse } = require('../translator.js');
const { MODELS, boundedText } = require('../security.js');

class TranslationProvider {
  constructor({ config = {}, fetchImpl = globalThis.fetch } = {}) {
    this.model = config.model ?? MODELS[0];
    if (![...MODELS, 'deepseek/deepseek-v4.1-flash-1017'].includes(this.model))
      throw new Error('Unsupported evaluation model.');
    this.offline = config.offline === true;
    this.fetch = fetchImpl;
  }
  id() {
    return `${this.offline ? 'offline-harness' : 'openrouter'}:${this.model}`;
  }
  async callApi(prompt, _context, options = {}) {
    let key = '';
    if (!this.offline) {
      key = process.env.OPENROUTER_API_KEY?.trim();
      if (!key)
        return {
          error: 'Set OPENROUTER_API_KEY in the environment or local .env. No request was sent.',
        };
    }
    try {
      const template = JSON.parse(prompt);
      const input = JSON.parse(template.messages[1].content);
      const req = buildAiRequest({
        apiKey: key,
        model: this.model,
        word: boundedText(input.selection, 2000, true),
        context: boundedText(input.sentence ?? '', 3000),
        wide: boundedText(input.surroundingSentences ?? '', 3000),
        avoid: boundedText(input.rejectedTranslation ?? '', 2000),
      });
      // Prevent the eval configuration from silently diverging from the production prompt.
      if (
        JSON.stringify(template.messages) !== JSON.stringify(JSON.parse(req.options.body).messages)
      ) {
        return {
          error: 'Prompt changed during evaluation; rerun with the current production prompt.',
        };
      }
      let json;
      if (this.offline) {
        // Only transport/schema plumbing is tested here, never model quality.
        const fixture = require('./offline-fixtures.cjs')[input.selection];
        if (!fixture) return { error: 'Missing offline fixture.' };
        json = { choices: [{ message: { content: JSON.stringify(fixture) } }] };
      } else {
        const signal = options.abortSignal
          ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000);
        const response = await this.fetch(req.url, { ...req.options, signal });
        if (!response.ok)
          return {
            error: `OpenRouter HTTP ${response.status}. No fallback provider was contacted.`,
          };
        json = await response.json();
      }
      const parsed = parseAiResponse(json);
      const result = {
        ...(parsed
          ? { output: JSON.stringify(parsed) }
          : { error: 'Production parser rejected the model response.' }),
        metadata: {
          model: this.model,
          returnedModel: json.model,
          offline: this.offline,
          finishReason: json.choices?.[0]?.finish_reason,
          ...(!parsed
            ? {
                rawOutput: String(json.choices?.[0]?.message?.content ?? '')
                  .slice(0, 12000)
                  .replaceAll(key || 'never-a-secret-placeholder', '[REDACTED]'),
              }
            : {}),
        },
      };
      if (json.usage) {
        result.tokenUsage = {
          total: json.usage.total_tokens,
          prompt: json.usage.prompt_tokens,
          completion: json.usage.completion_tokens,
        };
        if (Number.isFinite(json.usage.cost) && json.usage.cost >= 0) result.cost = json.usage.cost;
      }
      return result;
    } catch {
      // Never print raw headers, request bodies, or errors that may contain credentials.
      return {
        error: 'Translation evaluation failed: timeout, network failure, or invalid response.',
      };
    }
  }
}
module.exports = TranslationProvider;
