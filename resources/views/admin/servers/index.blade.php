@extends('layouts.admin')

@section('title')
    List Servers
@endsection

@section('scripts')
    @parent
    <style>
        .server-list-header {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }

        .server-list-header .box-title {
            margin-right: auto;
        }

        .server-list-controls {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
        }

        .server-list-sort-label {
            margin: 0;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: .04em;
            text-transform: uppercase;
            color: #8aa4be;
        }

        .server-list-sort {
            width: auto;
        }

        .server-list-search input {
            width: 200px;
        }

        .server-list-table > tbody > tr > th {
            font-size: 11px;
            letter-spacing: .04em;
            text-transform: uppercase;
            color: #8aa4be;
        }

        .server-list-table > tbody > tr.server-node-group > td {
            padding: 6px 10px;
            border-top: 2px solid rgba(255, 255, 255, .12);
            background: rgba(255, 255, 255, .04);
            font-weight: 600;
        }

        /* The first group sits directly under the headings, so it needs no divider above. */
        .server-list-table > tbody > tr.server-node-group:first-of-type > td {
            border-top-width: 1px;
        }

        .server-list-table > tbody > tr.server-node-group .fa-server {
            margin-right: 6px;
            opacity: .6;
        }

        .server-node-group-meta {
            margin-left: 10px;
            font-weight: 400;
            font-size: 12px;
            opacity: .65;
        }

        .server-list-table .server-power-state {
            display: inline-block;
            min-width: 68px;
        }
    </style>
@endsection

@section('content-header')
    <h1>Servers<small>All servers available on the system.</small></h1>
    <ol class="breadcrumb">
        <li><a href="{{ route('admin.index') }}">Admin</a></li>
        <li class="active">Servers</li>
    </ol>
@endsection

@section('content')
<div class="row">
    <div class="col-xs-12">
        <div class="box box-primary">
            {{-- Flex header instead of the absolutely positioned .box-tools: the extra sort
                 control made the toolbar wrap and overlap the table headings. --}}
            <div class="box-header with-border server-list-header">
                <h3 class="box-title">Server List</h3>
                <form action="{{ route('admin.servers') }}" method="GET" class="server-list-controls">
                    <label class="server-list-sort-label" for="serverSort">Sort by</label>
                    <select name="sort" id="serverSort" class="form-control input-sm server-list-sort" onchange="this.form.submit();">
                        <option value="" @if($sort === '') selected @endif>Default order</option>
                        <option value="name" @if($sort === 'name') selected @endif>Name A-Z</option>
                        <option value="-name" @if($sort === '-name') selected @endif>Name Z-A</option>
                        <option value="node" @if($sort === 'node') selected @endif>Node A-Z</option>
                        <option value="-node" @if($sort === '-node') selected @endif>Node Z-A</option>
                    </select>
                    <div class="input-group input-group-sm server-list-search">
                        <input type="text" name="filter[*]" class="form-control" value="{{ request()->input()['filter']['*'] ?? '' }}" placeholder="Search Servers">
                        <div class="input-group-btn">
                            <button type="submit" class="btn btn-default"><i class="fa fa-search"></i></button>
                        </div>
                    </div>
                    <a href="{{ route('admin.servers.new') }}" class="btn btn-sm btn-primary">Create New</a>
                </form>
            </div>
            <div class="box-body table-responsive no-padding">
                @php
                    $groupByNode = in_array($sort, ['node', '-node'], true);
                    $nodeCounts = $servers->groupBy('node_id')->map->count();
                    $currentNodeId = null;
                @endphp
                <table class="table table-hover server-list-table">
                    <tbody>
                        <tr>
                            <th>Server Name</th>
                            <th>UUID</th>
                            <th>Owner</th>
                            <th>Node</th>
                            <th>Connection</th>
                            <th class="text-center">Power</th>
                            <th class="text-center">Status</th>
                            <th></th>
                        </tr>
                        @foreach ($servers as $server)
                            @if($groupByNode && $currentNodeId !== $server->node_id)
                                @php $currentNodeId = $server->node_id; @endphp
                                <tr class="server-node-group">
                                    <td colspan="8">
                                        <i class="fa fa-server"></i>
                                        <a href="{{ route('admin.nodes.view', $server->node->id) }}">{{ $server->node->name }}</a>
                                        <span class="server-node-group-meta">
                                            {{ $server->node->fqdn }} &middot;
                                            {{ trans_choice(':count server|:count servers', $nodeCounts[$server->node_id], ['count' => $nodeCounts[$server->node_id]]) }}
                                        </span>
                                    </td>
                                </tr>
                            @endif
                            <tr data-server="{{ $server->uuidShort }}" data-uuid="{{ $server->uuid }}">
                                <td><a href="{{ route('admin.servers.view', $server->id) }}">{{ $server->name }}</a></td>
                                <td><code title="{{ $server->uuid }}">{{ $server->uuid }}</code></td>
                                <td><a href="{{ route('admin.users.view', $server->user->id) }}">{{ $server->user->username }}</a></td>
                                <td><a href="{{ route('admin.nodes.view', $server->node->id) }}">{{ $server->node->name }}</a></td>
                                <td>
                                    <code>{{ $server->allocation->alias }}:{{ $server->allocation->port }}</code>
                                </td>
                                <td class="text-center">
                                    <span class="label label-default server-power-state" data-state="pending">
                                        <i class="fa fa-circle-o-notch fa-spin"></i>
                                    </span>
                                </td>
                                <td class="text-center">
                                    @if($server->isSuspended())
                                        <span class="label bg-maroon">Suspended</span>
                                    @elseif(! $server->isInstalled())
                                        <span class="label label-warning">Installing</span>
                                    @else
                                        <span class="label label-success">Active</span>
                                    @endif
                                </td>
                                <td class="text-center">
                                    <a class="btn btn-xs btn-default" href="/server/{{ $server->uuidShort }}"><i class="fa fa-wrench"></i></a>
                                </td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            </div>
            @if($servers->hasPages())
                <div class="box-footer with-border">
                    <div class="col-md-12 text-center">{!! $servers->appends(['filter' => Request::input('filter'), 'sort' => $sort])->render() !!}</div>
                </div>
            @endif
        </div>
    </div>
</div>
@endsection

@section('footer-scripts')
    @parent
    <script>
        $('.console-popout').on('click', function (event) {
            event.preventDefault();
            window.open($(this).attr('href'), 'Pterodactyl Console', 'width=800,height=400');
        });

        (function () {
            // The power state comes from Wings, so it is fetched after the page renders and
            // refreshed periodically instead of blocking the server list itself.
            var labels = {
                running: { text: 'Running', className: 'label-success' },
                starting: { text: 'Starting', className: 'label-warning' },
                stopping: { text: 'Stopping', className: 'label-warning' },
                offline: { text: 'Offline', className: 'label-danger' },
                unknown: { text: 'Unknown', className: 'label-default' },
            };

            var update = function () {
                var rows = $('tr[data-uuid]');
                if (rows.length === 0) {
                    return;
                }

                var params = rows
                    .map(function () {
                        return 'uuids[]=' + encodeURIComponent($(this).data('uuid'));
                    })
                    .get()
                    .join('&');

                $.getJSON('{{ route('admin.servers.statuses') }}?' + params)
                    .done(function (response) {
                        rows.each(function () {
                            var entry = (response.data || {})[$(this).data('uuid')];
                            var state = (entry && entry.state) || 'unknown';
                            var label = labels[state] || labels.unknown;

                            $(this)
                                .find('.server-power-state')
                                .attr('class', 'label server-power-state ' + label.className)
                                .attr('data-state', state)
                                .text(label.text);
                        });
                    })
                    .fail(function () {
                        rows.find('.server-power-state[data-state="pending"]')
                            .attr('class', 'label label-default server-power-state')
                            .attr('data-state', 'unknown')
                            .text(labels.unknown.text);
                    });
            };

            update();
            setInterval(update, 15000);
        })();
    </script>
@endsection
