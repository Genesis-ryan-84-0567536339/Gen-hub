"""Idempotent schema migration & seeding for Kho Ryan in Baserow.
Reads kho/schema.json as SSOT, applies workspaces, databases, tables,
fields, formula IDs, link relationships, views, and initial seed data.
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

SCHEMA_FILE = pathlib.Path(__file__).resolve().parent / 'schema.json'


class BaserowClient:
    def __init__(self, base_url, jwt_token=None, database_token=None):
        self.base_url = base_url.rstrip('/')
        self.jwt_token = jwt_token
        self.database_token = database_token

    def _headers(self):
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
        if self.jwt_token:
            headers['Authorization'] = f'JWT {self.jwt_token}'
        elif self.database_token:
            headers['Authorization'] = f'Token {self.database_token}'
        return headers

    def request(self, method, endpoint, data=None):
        url = f'{self.base_url}{endpoint}'
        body = json.dumps(data).encode('utf-8') if data is not None else None
        import time
        for attempt in range(6):
            req = urllib.request.Request(url, data=body, headers=self._headers(), method=method)
            try:
                with urllib.request.urlopen(req) as resp:
                    resp_text = resp.read().decode('utf-8')
                    return json.loads(resp_text) if resp_text else None
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8') if e.fp else ''
                if e.code == 409 and ('LOCK_TABLE' in err_body or 'CONFLICT' in err_body) and attempt < 5:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise RuntimeError(f'Baserow API error {e.code} on {method} {endpoint}: {err_body}') from e


def load_schema():
    return json.loads(SCHEMA_FILE.read_text(encoding='utf-8'))


def sync_schema(client, schema=None, output_table_ids=None):
    """Synchronize Baserow database with declarative schema in an idempotent way."""
    if schema is None:
        schema = load_schema()

    workspace_name = schema.get('workspace', 'Ryan Kho')
    database_name = schema.get('database', 'Kho Ryan')

    # 1. Get or create Workspace
    workspaces = client.request('GET', '/api/workspaces/') or []
    workspace = next((w for w in workspaces if w.get('name') == workspace_name), None)
    if not workspace:
        print(f"Creating workspace '{workspace_name}'...")
        workspace = client.request('POST', '/api/workspaces/', {'name': workspace_name})
    workspace_id = workspace['id']

    # 2. Get or create Database Application
    apps = client.request('GET', f'/api/applications/workspace/{workspace_id}/') or []
    database = next((a for a in apps if a.get('name') == database_name and a.get('type') == 'database'), None)
    if not database:
        print(f"Creating database '{database_name}'...")
        database = client.request('POST', f'/api/applications/workspace/{workspace_id}/', {
            'name': database_name,
            'type': 'database'
        })
    database_id = database['id']

    # 3. Get or create Tables
    existing_tables = client.request('GET', f'/api/database/tables/database/{database_id}/') or []
    tables_map = {t['name']: t for t in existing_tables}

    for table_def in schema['tables']:
        name = table_def['name']
        if name not in tables_map:
            print(f"Creating table '{name}'...")
            primary_def = next((f for f in table_def['fields'] if f.get('primary')), None)
            primary_name = primary_def['name'] if primary_def else 'Tên'
            payload = {
                'name': name,
                'data': [[primary_name]],
                'first_row_header': True
            }
            t = client.request('POST', f'/api/database/tables/database/{database_id}/', payload)
            tables_map[name] = t

    # 4. Synchronize Fields for each Table
    link_fields_to_resolve = []

    for table_def in schema['tables']:
        table_name = table_def['name']
        table_id = tables_map[table_name]['id']
        fields = client.request('GET', f'/api/database/fields/table/{table_id}/') or []
        fields_map = {f['name']: f for f in fields}

        # Check primary field
        primary_def = next((f for f in table_def['fields'] if f.get('primary')), None)
        primary_field = next((f for f in fields if f.get('primary')), None)
        if primary_def and primary_field and primary_field['name'] != primary_def['name']:
            client.request('PATCH', f"/api/database/fields/{primary_field['id']}/", {
                'name': primary_def['name']
            })
            fields_map[primary_def['name']] = primary_field

        # Remove default unwanted Baserow fields (Notes, Active)
        for f in fields:
            if not f.get('primary') and f['name'] in ['Notes', 'Active']:
                print(f"Removing default Baserow field '{f['name']}' from '{table_name}'...")
                try:
                    client.request('DELETE', f"/api/database/fields/{f['id']}/")
                    fields_map.pop(f['name'], None)
                except Exception as e:
                    print(f"Warning removing field '{f['name']}': {e}", file=sys.stderr)

        # Remove default blank rows created by Baserow
        existing_rows_resp = client.request('GET', f'/api/database/rows/table/{table_id}/?user_field_names=true') or {}
        existing_rows = existing_rows_resp.get('results', [])
        primary_name = primary_def['name'] if primary_def else 'Tên'
        for row in existing_rows:
            pval = row.get(primary_name)
            if pval is None or pval == '' or (isinstance(pval, str) and not pval.strip()):
                has_meaningful_data = any(
                    bool(v) for k, v in row.items()
                    if k not in ['id', 'order', 'Mã ID', primary_name]
                )
                if not has_meaningful_data:
                    print(f"Deleting default blank row {row['id']} from '{table_name}'...")
                    try:
                        client.request('DELETE', f"/api/database/rows/table/{table_id}/{row['id']}/")
                    except Exception as e:
                        print(f"Warning deleting blank row {row['id']}: {e}", file=sys.stderr)

        for field_def in table_def['fields']:
            fname = field_def['name']
            if fname in fields_map:
                continue

            ftype = field_def['type']
            if ftype == 'link_row':
                link_fields_to_resolve.append((table_id, table_name, field_def))
                continue

            payload = {'name': fname, 'type': ftype}
            if ftype == 'formula':
                payload['formula'] = field_def['formula']
            elif ftype == 'single_select':
                payload['select_options'] = [{'value': opt, 'color': 'light-blue'} for opt in field_def.get('options', [])]
            elif ftype == 'date':
                payload['date_format'] = 'ISO'
                payload['date_include_time'] = False

            print(f"Adding field '{fname}' ({ftype}) to '{table_name}'...")
            try:
                created_field = client.request('POST', f'/api/database/fields/table/{table_id}/', payload)
                fields_map[fname] = created_field
            except Exception as e:
                print(f"Warning adding field '{fname}': {e}", file=sys.stderr)

    # 5. Resolve Link Row Fields
    for table_id, table_name, field_def in link_fields_to_resolve:
        fname = field_def['name']
        target_name = field_def['target_table']
        target_table = tables_map.get(target_name)
        if not target_table:
            continue
        fields = client.request('GET', f'/api/database/fields/table/{table_id}/') or []
        if any(f['name'] == fname for f in fields):
            continue

        print(f"Linking table '{table_name}' -> '{target_name}' via field '{fname}'...")
        payload = {
            'name': fname,
            'type': 'link_row',
            'link_row_table_id': target_table['id']
        }
        try:
            client.request('POST', f'/api/database/fields/table/{table_id}/', payload)
        except Exception as e:
            print(f"Warning linking '{fname}': {e}", file=sys.stderr)

    # 6. Synchronize Views
    for table_def in schema['tables']:
        table_name = table_def['name']
        table_id = tables_map[table_name]['id']
        views = client.request('GET', f'/api/database/views/table/{table_id}/') or []
        existing_views = {v['name'] for v in views}
        for view_def in table_def.get('views', []):
            vname = view_def['name']
            if vname in existing_views:
                continue
            print(f"Creating view '{vname}' on '{table_name}'...")
            payload = {'name': vname, 'type': view_def['type']}
            try:
                client.request('POST', f'/api/database/views/table/{table_id}/', payload)
            except Exception as e:
                print(f"Warning creating view '{vname}': {e}", file=sys.stderr)

    # 7. Seed Initial Data
    seed_data = schema.get('seed_data', {})
    for table_name, rows in seed_data.items():
        if table_name not in tables_map:
            continue
        table_id = tables_map[table_name]['id']
        table_def = next((t for t in schema['tables'] if t['name'] == table_name), None)
        primary_def = next((f for f in table_def['fields'] if f.get('primary')), None) if table_def else None
        primary_name = primary_def['name'] if primary_def else 'Tên'

        existing_resp = client.request('GET', f'/api/database/rows/table/{table_id}/?user_field_names=true') or {}
        existing_rows = existing_resp.get('results', [])
        existing_primary_values = {
            str(r.get(primary_name, '')).strip() for r in existing_rows if r.get(primary_name)
        }

        for row in rows:
            seed_val = str(row.get(primary_name, '')).strip()
            if seed_val and seed_val in existing_primary_values:
                continue

            print(f"Seeding initial data for '{table_name}': {seed_val or row}...")
            try:
                client.request('POST', f'/api/database/rows/table/{table_id}/?user_field_names=true', row)
                if seed_val:
                    existing_primary_values.add(seed_val)
            except Exception as e:
                print(f"Warning seeding row in '{table_name}': {e}", file=sys.stderr)

    # 8. Export Prefix -> Table ID Mapping
    prefix_to_table_id = {}
    for table_def in schema['tables']:
        tname = table_def['name']
        prefix = table_def.get('prefix', '').rstrip('-')
        if tname in tables_map and prefix:
            prefix_to_table_id[prefix] = tables_map[tname]['id']

    table_ids_path = output_table_ids or os.environ.get('KHO_TABLE_IDS_PATH')
    if not table_ids_path:
        data_dir = os.environ.get('DATA_DIR')
        if data_dir and os.path.isdir(data_dir):
            table_ids_path = os.path.join(data_dir, 'kho_table_ids.json')
        elif os.path.isdir('/data'):
            table_ids_path = '/data/kho_table_ids.json'
        elif os.path.isdir('/var/lib/gen-hub/data'):
            table_ids_path = '/var/lib/gen-hub/data/kho_table_ids.json'
        else:
            os.makedirs('./var', exist_ok=True)
            table_ids_path = './var/kho_table_ids.json'
    try:
        with open(table_ids_path, 'w', encoding='utf-8') as f:
            json.dump(prefix_to_table_id, f, indent=2, ensure_ascii=False)
        print(f"✓ Đã lưu bản đồ tiền tố -> table_id tại {table_ids_path}")
    except Exception as e:
        print(f"Cảnh báo lưu table_ids: {e}", file=sys.stderr)

    print("✓ Đồng bộ schema Kho Ryan và dữ liệu ban đầu hoàn tất.")
    return {
        'workspace_id': workspace_id,
        'database_id': database_id,
        'tables': tables_map,
        'prefix_to_table_id': prefix_to_table_id,
        'table_ids_path': table_ids_path
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Synchronize Kho Ryan schema to Baserow")
    parser.add_argument('--url', default=os.environ.get('BASEROW_URL', 'http://127.0.0.1:80'), help='Baserow instance URL')
    parser.add_argument('--jwt', default=os.environ.get('BASEROW_JWT'), help='Baserow user JWT token')
    parser.add_argument('--token', default=os.environ.get('BASEROW_TOKEN'), help='Baserow database API token')
    parser.add_argument('--output', default=os.environ.get('KHO_TABLE_IDS_PATH'), help='Path to output table_ids.json')
    args, _ = parser.parse_known_args()

    base_url = args.url
    jwt_token = args.jwt
    db_token = args.token
    if not jwt_token and not db_token:
        print("Usage: python3 kho/schema.py --url <URL> --token <TOKEN> (or set BASEROW_URL / BASEROW_TOKEN)", file=sys.stderr)
        sys.exit(1)
    client = BaserowClient(base_url, jwt_token=jwt_token, database_token=db_token)
    sync_schema(client, output_table_ids=args.output)


if __name__ == '__main__':
    main()
