//! CLI exporter for the canonical WASM constants registry.
//!
//! Usage:
//!   cargo run --bin export_wasm_constants -- --format js
//!   cargo run --bin export_wasm_constants -- --format json
//!
//! Only generated output is written to stdout. Diagnostics go to stderr and
//! cause a non-zero exit code.

use std::env;
use std::process::ExitCode;

use dog_walker_core::wasm_contract_export::{render_js, render_json};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputFormat {
    Js,
    Json,
}

fn main() -> ExitCode {
    match run() {
        Ok((format, rendered)) => {
            // `render_js()` already terminates with a newline, so `print!`
            // avoids emitting an extra blank line at EOF. `render_json()`
            // does not end with a newline, so it still uses `println!`.
            match format {
                OutputFormat::Js => print!("{}", rendered),
                OutputFormat::Json => println!("{}", rendered),
            }
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("error: {}", message);
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(OutputFormat, String), String> {
    let format = parse_format()?;
    let rendered = match format {
        OutputFormat::Js => render_js(),
        OutputFormat::Json => render_json(),
    };
    Ok((format, rendered))
}

fn parse_format() -> Result<OutputFormat, String> {
    let mut format: Option<String> = None;
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        if arg == "--format" {
            if format.is_some() {
                return Err("`--format` may only be specified once".to_owned());
            }
            let value = args
                .next()
                .ok_or_else(|| "`--format` requires a value (`js` or `json`)".to_owned())?;
            format = Some(value);
        } else {
            return Err(format!("unexpected argument `{}`", arg));
        }
    }

    match format.as_deref() {
        Some("js") => Ok(OutputFormat::Js),
        Some("json") => Ok(OutputFormat::Json),
        Some(other) => Err(format!(
            "unsupported format `{}`; expected `js` or `json`",
            other
        )),
        None => Err("missing required `--format <js|json>`".to_owned()),
    }
}
