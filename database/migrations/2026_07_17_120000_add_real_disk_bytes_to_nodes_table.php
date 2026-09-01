<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->unsignedBigInteger('real_disk_bytes')->nullable()->after('disk_overallocate');
            $table->timestamp('real_disk_checked_at')->nullable()->after('real_disk_bytes');
        });
    }

    public function down(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->dropColumn(['real_disk_bytes', 'real_disk_checked_at']);
        });
    }
};
