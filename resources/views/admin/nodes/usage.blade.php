@extends('layouts.admin')

@section('title')
    Zużycie węzłów
@endsection

@section('content-header')
    <h1>Zużycie węzłów<small>Bieżące zużycie zasobów na każdym węźle.</small></h1>
    <ol class="breadcrumb">
        <li><a href="{{ route('admin.index') }}">Admin</a></li>
        <li class="active">Zużycie węzłów</li>
    </ol>
@endsection

@section('content')
<style>
    #node-usage-table th.sortable {
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
    }

    #node-usage-table th.sortable .sort-indicator {
        color: #9aa5b1;
        margin-left: 4px;
    }

    #node-usage-table th.sortable.active .sort-indicator {
        color: #3c8dbc;
    }
</style>
<div class="row">
    <div class="col-xs-12">
        <div class="box box-primary">
            <div class="box-header with-border">
                <h3 class="box-title">Monitor zasobów</h3>
                <div class="box-tools">
                    <span class="label label-default" id="usage-updated-at">Ładowanie...</span>
                </div>
            </div>
            <div class="box-body table-responsive no-padding">
                <table class="table table-hover" id="node-usage-table">
                    <thead>
                        <tr>
                            <th class="sortable text-center" data-sort-key="status">Status <span class="sort-indicator"></span></th>
                            <th class="sortable" data-sort-key="name">Węzeł <span class="sort-indicator"></span></th>
                            <th class="sortable" data-sort-key="live_memory_bytes">RAM (live) <span class="sort-indicator"></span></th>
                            <th class="sortable" data-sort-key="live_cpu_absolute">CPU (live) <span class="sort-indicator"></span></th>
                            <th class="sortable" data-sort-key="live_disk_bytes">Dysk (live) <span class="sort-indicator"></span></th>
                            <th class="sortable" data-sort-key="allocated_memory_mib">Alokacja RAM <span class="sort-indicator"></span></th>
                            <th class="sortable" data-sort-key="allocated_disk_mib">Alokacja dysk <span class="sort-indicator"></span></th>
                            <th class="sortable text-center" data-sort-key="servers">Serwery <span class="sort-indicator"></span></th>
                        </tr>
                    </thead>
                    <tbody id="node-usage-body">
                        <tr>
                            <td colspan="8" class="text-center text-muted">
                                <i class="fa fa-refresh fa-spin"></i> Pobieranie danych z węzłów...
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="box-footer">
                <small class="text-muted">Dane odświeżane co 15 sekund. Odpowiedzi Wings są cache'owane po stronie panelu, aby nie obciążać węzłów.</small>
            </div>
        </div>
    </div>
</div>
@endsection

@section('footer-scripts')
    @parent
    <script>
    (function () {
        var refreshInterval = 15000;
        var latestUsage = null;
        var currentSort = {
            key: 'live_memory_bytes',
            direction: 'desc',
        };

        function formatBytes(bytes) {
            if (!bytes || bytes <= 0) return '0 B';
            var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
            var i = 0;
            var value = bytes;
            while (value >= 1024 && i < units.length - 1) {
                value /= 1024;
                i++;
            }
            return value.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
        }

        function formatMib(mib) {
            if (!mib || mib <= 0) return '0 MiB';
            if (mib >= 1024) return (mib / 1024).toFixed(1) + ' GiB';
            return mib.toLocaleString() + ' MiB';
        }

        // cpu_absolute is Docker-style (100% = one thread), so the bar is drawn
        // against the machine's total capacity (absolute / threads).
        function cpuTotalPercent(live, system) {
            if (typeof live.cpu_percent === 'number') {
                return live.cpu_percent;
            }

            var threads = system.cpu_threads || 0;
            return threads > 0 ? Math.min(100, (live.cpu_absolute || 0) / threads) : (live.cpu_absolute || 0);
        }

        function progressBar(percent, label) {
            var css = percent <= 60 ? 'progress-bar-success' : (percent <= 85 ? 'progress-bar-warning' : 'progress-bar-danger');
            var safePercent = Math.min(100, Math.max(0, percent));
            return '<div style="min-width:140px">' +
                '<small>' + label + '</small>' +
                '<div class="progress progress-xs" style="margin-bottom:0">' +
                '<div class="progress-bar ' + css + '" style="width:' + safePercent.toFixed(1) + '%"></div>' +
                '</div>' +
                '<small class="text-muted">' + safePercent.toFixed(1) + '%</small>' +
                '</div>';
        }

        function statusIcon(online) {
            if (online) {
                return '<i class="fa fa-heartbeat text-success" title="Online"></i>';
            }
            return '<i class="fa fa-heart-o text-danger" title="Offline"></i>';
        }

        function getSortValue(node, key) {
            switch (key) {
                case 'status':
                    return node.online ? 1 : 0;
                case 'name':
                    return (node.name || '').toLowerCase();
                case 'live_memory_bytes':
                    return node.online ? (node.live.memory_bytes || 0) : -1;
                case 'live_cpu_absolute':
                    return node.online ? cpuTotalPercent(node.live, node.system) : -1;
                case 'live_disk_bytes':
                    return node.online ? (node.live.disk_bytes || 0) : -1;
                case 'allocated_memory_mib':
                    return node.allocated.memory_mib || 0;
                case 'allocated_disk_mib':
                    return node.allocated.disk_mib || 0;
                case 'servers':
                    return [
                        node.live.running_servers || 0,
                        node.servers_count || 0,
                    ];
                default:
                    return 0;
            }
        }

        function compareValues(a, b) {
            if (Array.isArray(a) && Array.isArray(b)) {
                for (var i = 0; i < Math.max(a.length, b.length); i++) {
                    var result = compareValues(a[i] === undefined ? 0 : a[i], b[i] === undefined ? 0 : b[i]);
                    if (result !== 0) return result;
                }

                return 0;
            }

            if (typeof a === 'string' || typeof b === 'string') {
                return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
            }

            return (a || 0) - (b || 0);
        }

        function sortNodes(nodes) {
            return nodes.slice().sort(function (a, b) {
                var result = compareValues(getSortValue(a, currentSort.key), getSortValue(b, currentSort.key));

                if (result === 0) {
                    result = compareValues(getSortValue(a, 'name'), getSortValue(b, 'name'));
                }

                return currentSort.direction === 'asc' ? result : -result;
            });
        }

        function updateSortIndicators() {
            $('#node-usage-table th.sortable').each(function () {
                var $th = $(this);
                var active = $th.data('sort-key') === currentSort.key;

                $th.toggleClass('active', active);
                $th.find('.sort-indicator').html(active ? (currentSort.direction === 'asc' ? '&#9650;' : '&#9660;') : '');
            });
        }

        function renderNodes(data) {
            latestUsage = data;

            var $body = $('#node-usage-body');
            $body.empty();

            if (!data.nodes || !data.nodes.length) {
                $body.append('<tr><td colspan="8" class="text-center text-muted">Brak węzłów.</td></tr>');
                return;
            }

            sortNodes(data.nodes).forEach(function (node) {
                var maintenance = node.maintenance_mode ? '<span class="label label-warning"><i class="fa fa-wrench"></i></span> ' : '';
                var ramLabel = formatBytes(node.live.memory_bytes) + ' / ' + formatBytes(node.system.memory_bytes);
                var diskTotalLabel = node.system.disk_total_bytes
                    ? formatBytes(node.system.disk_total_bytes)
                    : formatMib(node.allocated.disk_max_mib);
                var diskLabel = formatBytes(node.live.disk_bytes) + ' / ' + diskTotalLabel;
                var allocRamLabel = formatMib(node.allocated.memory_mib) + ' / ' + formatMib(node.allocated.memory_max_mib);
                var allocDiskLabel = formatMib(node.allocated.disk_mib) + ' / ' + formatMib(node.allocated.disk_max_mib);
                var cpuPercent = cpuTotalPercent(node.live, node.system);
                var cpuLabel = node.live.cpu_absolute.toFixed(1) + '% (' + (node.system.cpu_threads || 0) + ' wątków · ' + cpuPercent.toFixed(1) + '% całości)';

                var row = '<tr>' +
                    '<td class="text-center">' + statusIcon(node.online) + '</td>' +
                    '<td>' + maintenance + '<a href="/admin/nodes/view/' + node.id + '">' + $('<div>').text(node.name).html() + '</a>' +
                    '<br><small class="text-muted">' + $('<div>').text(node.location).html() +
                    (node.wings_version ? ' · Wings ' + node.wings_version : '') + '</small></td>' +
                    '<td>' + (node.online ? progressBar(node.live.memory_percent, ramLabel) : '<span class="text-muted">—</span>') + '</td>' +
                    '<td>' + (node.online ? progressBar(cpuPercent, cpuLabel) : '<span class="text-muted">—</span>') + '</td>' +
                    '<td>' + (node.online ? progressBar(node.live.disk_percent, diskLabel) : '<span class="text-muted">—</span>') + '</td>' +
                    '<td>' + progressBar(node.allocated.memory_percent, allocRamLabel) + '</td>' +
                    '<td>' + progressBar(node.allocated.disk_percent, allocDiskLabel) + '</td>' +
                    '<td class="text-center">' + node.live.running_servers + ' / ' + node.servers_count + '</td>' +
                    '</tr>';

                $body.append(row);
            });

            if (data.updated_at) {
                var date = new Date(data.updated_at);
                $('#usage-updated-at').text('Ostatnia aktualizacja: ' + date.toLocaleTimeString());
            }

            updateSortIndicators();
        }

        var refreshTimer = null;

        function scheduleRefresh() {
            clearTimeout(refreshTimer);
            if (document.visibilityState === 'visible') {
                refreshTimer = setTimeout(loadUsage, refreshInterval);
            }
        }

        function loadUsage() {
            if (document.visibilityState !== 'visible') {
                return;
            }

            $.ajax({
                url: '{{ route('admin.nodes.usage.stats') }}',
                method: 'GET',
                timeout: 30000,
            }).done(function (data) {
                renderNodes(data);
                refreshInterval = (data.cached_seconds || 15) * 1000;
            }).fail(function () {
                $('#node-usage-body').html('<tr><td colspan="8" class="text-center text-danger">Nie udało się pobrać danych z węzłów.</td></tr>');
            }).always(function () {
                scheduleRefresh();
            });
        }

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                loadUsage();
            } else {
                clearTimeout(refreshTimer);
            }
        });

        $('#node-usage-table th.sortable').on('click', function () {
            var key = $(this).data('sort-key');

            if (currentSort.key === key) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.key = key;
                currentSort.direction = key === 'name' ? 'asc' : 'desc';
            }

            if (latestUsage) {
                renderNodes(latestUsage);
            } else {
                loadUsage();
            }
        });

        updateSortIndicators();
        loadUsage();
    })();
    </script>
@endsection
