<?php

namespace Pterodactyl\Http\Controllers\Admin\Servers;

use Illuminate\View\View;
use Illuminate\Http\Request;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\Server;
use Spatie\QueryBuilder\QueryBuilder;
use Spatie\QueryBuilder\AllowedSort;
use Spatie\QueryBuilder\AllowedFilter;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Models\Filters\AdminServerFilter;

class ServerController extends Controller
{
    /**
     * Returns all the servers that exist on the system using a paginated result set. If
     * a query is passed along in the request it is also passed to the repository function.
     */
    public function index(Request $request): View
    {
        $servers = QueryBuilder::for(Server::query()->with('node', 'user', 'allocation'))
            ->allowedFilters([
                AllowedFilter::exact('owner_id'),
                AllowedFilter::custom('*', new AdminServerFilter()),
            ])
            ->allowedSorts([
                AllowedSort::field('id'),
                AllowedSort::field('name'),
                // Servers hold only a node_id, so sort on the related node name and keep the
                // servers inside each node grouped alphabetically.
                AllowedSort::callback('node', function ($query, bool $descending) {
                    $query
                        ->orderBy(
                            Node::select('name')->whereColumn('nodes.id', 'servers.node_id'),
                            $descending ? 'desc' : 'asc'
                        )
                        ->orderBy('servers.name', 'asc');
                }),
            ])
            ->defaultSort('id')
            ->paginate(config()->get('pterodactyl.paginate.admin.servers'));

        return view('admin.servers.index', [
            'servers' => $servers,
            'sort' => $request->query('sort', ''),
        ]);
    }
}
