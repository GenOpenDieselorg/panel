<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    public function up(): void
    {
        // Global, panel-wide overrides for the plugin update checker, keyed by the plugin name
        // declared in plugin.yml (lowercased). A rule either blacklists a plugin from update
        // checks entirely, or pins it to a specific Modrinth / SpigotMC project.
        Schema::create('plugin_update_rules', function (Blueprint $table) {
            $table->increments('id');
            $table->string('plugin_key', 191)->unique();
            $table->string('plugin_name');
            $table->string('type', 16);
            $table->string('source', 16)->nullable();
            $table->string('project_id', 64)->nullable();
            $table->string('project_url')->nullable();
            $table->unsignedInteger('created_by')->nullable();
            $table->timestamps();
        });

        // One row per plugin jar in a server's /plugins directory, refreshed by the daily
        // update check. Jar metadata is cached against the file's size and mtime so unchanged
        // jars are not downloaded from the daemon again.
        Schema::create('server_plugins', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('server_id');
            $table->string('file_name', 191);
            $table->unsignedBigInteger('file_size');
            $table->string('file_modified_at', 64)->nullable();
            $table->char('sha1', 40)->nullable();
            $table->string('plugin_key', 191)->nullable();
            $table->string('plugin_name')->nullable();
            $table->string('plugin_version')->nullable();
            $table->string('plugin_platform', 16)->nullable();
            $table->json('plugin_authors')->nullable();
            $table->string('status', 24)->default('pending');
            $table->string('source', 16)->nullable();
            $table->string('project_id', 64)->nullable();
            $table->string('project_title')->nullable();
            $table->string('project_url')->nullable();
            $table->string('latest_version')->nullable();
            $table->string('latest_version_id', 64)->nullable();
            $table->text('download_url')->nullable();
            $table->string('download_file_name')->nullable();
            $table->json('latest_game_versions')->nullable();
            $table->text('error')->nullable();
            $table->timestamp('checked_at')->nullable();
            $table->timestamps();

            $table->unique(['server_id', 'file_name']);
            $table->index('plugin_key');
            $table->index(['file_name', 'file_size']);
            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('server_plugins');
        Schema::dropIfExists('plugin_update_rules');
    }
};
