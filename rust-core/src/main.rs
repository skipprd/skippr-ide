use clap::Parser;
use serde::Serialize;

#[derive(Parser, Debug)]
#[command(name = "skippr-ide-core")]
struct Cli {
    #[arg(long)]
    panel_id: String,
    #[arg(long)]
    panel_name: String,
    #[arg(long, default_value = "")]
    workspace_path: String,
    #[arg(long, default_value = "")]
    api_target: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionSettings {
    workspace_path: String,
    api_target: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResourceNode {
    id: String,
    label: String,
    kind: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogEntry {
    id: String,
    name: String,
    owner: String,
    tags: Vec<String>,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaDiff {
    model: String,
    before: Vec<String>,
    after: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelData {
    panel_id: String,
    panel_name: String,
    resources: Vec<ResourceNode>,
    catalog: Vec<CatalogEntry>,
    diff: SchemaDiff,
    diagnostics: Vec<String>,
    settings: ConnectionSettings,
}

fn main() {
    let args = Cli::parse();
    let settings = ConnectionSettings {
        workspace_path: args.workspace_path.clone(),
        api_target: if args.api_target.trim().is_empty() {
            None
        } else {
            Some(args.api_target.clone())
        },
    };

    let diagnostics = if settings.workspace_path.trim().is_empty() {
        vec!["No workspace path configured. Run 'Skippr: Configure Connection'.".to_string()]
    } else {
        vec![
            format!("Workspace: {}", settings.workspace_path),
            format!(
                "API target: {}",
                settings
                    .api_target
                    .clone()
                    .unwrap_or_else(|| "mock-only".to_string())
            ),
        ]
    };

    let payload = PanelData {
        panel_id: args.panel_id,
        panel_name: args.panel_name,
        resources: vec![
            ResourceNode {
                id: "r1".to_string(),
                label: "bike_hire_raw".to_string(),
                kind: "source".to_string(),
                path: "sources/bike_hire_raw.yml".to_string(),
            },
            ResourceNode {
                id: "r2".to_string(),
                label: "bike_hire_sync".to_string(),
                kind: "pipeline".to_string(),
                path: "syncs/bike_hire_sync.yml".to_string(),
            },
            ResourceNode {
                id: "r3".to_string(),
                label: "bike_hire_model".to_string(),
                kind: "model".to_string(),
                path: "models/bike_hire_model.sql".to_string(),
            },
            ResourceNode {
                id: "r4".to_string(),
                label: "bike_hire_daily".to_string(),
                kind: "table".to_string(),
                path: "catalog/bike_hire_daily".to_string(),
            },
        ],
        catalog: vec![
            CatalogEntry {
                id: "c1".to_string(),
                name: "bike_hire_daily".to_string(),
                owner: "data-platform".to_string(),
                tags: vec!["gold".to_string(), "published".to_string()],
                updated_at: "2026-05-12".to_string(),
            },
            CatalogEntry {
                id: "c2".to_string(),
                name: "bike_hire_station_dim".to_string(),
                owner: "analytics".to_string(),
                tags: vec!["silver".to_string()],
                updated_at: "2026-05-10".to_string(),
            },
        ],
        diff: SchemaDiff {
            model: "bike_hire_model".to_string(),
            before: vec![
                "ride_id".to_string(),
                "started_at".to_string(),
                "ended_at".to_string(),
                "duration_seconds".to_string(),
            ],
            after: vec![
                "ride_id".to_string(),
                "started_at".to_string(),
                "ended_at".to_string(),
                "duration_seconds".to_string(),
                "station_region".to_string(),
            ],
        },
        diagnostics,
        settings,
    };

    let encoded = serde_json::to_string(&payload).expect("Failed to serialize panel payload");
    println!("{encoded}");
}
