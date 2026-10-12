<?php

namespace Pterodactyl\Http\Controllers\Api\Client;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Pterodactyl\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Models\ServerPlugin;
use Pterodactyl\Models\PluginUpdateRule;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Services\Plugins\PluginSourceResolver;
use Pterodactyl\Services\Plugins\PluginUpdateCheckService;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Manages the panel-wide plugin update blacklist and the manual project links. Root admins only.
 */
class PluginUpdateRuleController extends ClientApiController
{
    public function __construct(
        private PluginSourceResolver $resolver,
        private PluginUpdateCheckService $checkService,
    ) {
        parent::__construct();
    }

    public function index(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        return new JsonResponse([
            'rules' => PluginUpdateRule::query()->orderBy('plugin_key')->get()->map(fn (PluginUpdateRule $rule) => [
                'id' => $rule->id,
                'plugin_name' => $rule->plugin_name,
                'type' => $rule->type,
                'source' => $rule->source,
                'project_url' => $rule->project_url,
                'created_at' => $rule->created_at->toAtomString(),
            ]),
        ]);
    }

    /**
     * Creates or replaces the rule for a plugin, then re-resolves every copy of it on the panel.
     *
     * @throws DisplayException
     */
    public function store(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $data = $request->validate([
            'plugin_name' => 'required|string|max:191',
            'type' => 'required|in:blacklist,link',
            'url' => 'required_if:type,link|nullable|string|max:255',
        ]);

        $attributes = ['plugin_name' => $data['plugin_name'], 'type' => $data['type'], 'source' => null, 'project_id' => null, 'project_url' => null];

        if ($data['type'] === PluginUpdateRule::TYPE_LINK) {
            $parsed = $this->resolver->parseProjectUrl($data['url']);
            if (!$parsed) {
                throw new DisplayException('Nie rozpoznano linku. Podaj adres projektu z modrinth.com/plugin/... albo spigotmc.org/resources/...');
            }

            $attributes = array_merge($attributes, $parsed, ['project_url' => trim($data['url'])]);
        }

        $rule = PluginUpdateRule::query()->updateOrCreate(
            ['plugin_key' => PluginUpdateRule::keyFor($data['plugin_name'])],
            $attributes + ['created_by' => $request->user()->id]
        );

        Activity::event('plugin-updates:rule.' . $rule->type)
            ->property('plugin', $rule->plugin_name)
            ->property('url', $rule->project_url)
            ->log();

        $this->reResolve($rule->plugin_key);

        return new JsonResponse(['id' => $rule->id], Response::HTTP_CREATED);
    }

    public function delete(Request $request, int $rule): JsonResponse
    {
        $this->authorizeAdmin($request);

        $model = PluginUpdateRule::query()->findOrFail($rule);
        $model->delete();

        Activity::event('plugin-updates:rule.delete')->property('plugin', $model->plugin_name)->log();

        $this->reResolve($model->plugin_key);

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    private function reResolve(string $pluginKey): void
    {
        $this->checkService->resolve(ServerPlugin::query()->where('plugin_key', $pluginKey)->get());
    }

    private function authorizeAdmin(Request $request): void
    {
        if (!$request->user()->root_admin) {
            throw new AccessDeniedHttpException('Tylko administrator może zmieniać reguły aktualizacji pluginów.');
        }
    }
}
