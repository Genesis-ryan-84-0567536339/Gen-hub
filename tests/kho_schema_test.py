import copy
import importlib.util
import json
import pathlib
import sys
import unittest
from unittest.mock import MagicMock, patch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("kho_schema", str(REPO_ROOT / 'kho' / 'schema.py'))
kho_schema = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kho_schema)


class MockBaserowClient:
    def __init__(self):
        self.workspaces = []
        self.apps = {}  # workspace_id -> [apps]
        self.tables = {}  # db_id -> [tables]
        self.fields = {}  # table_id -> [fields]
        self.views = {}  # table_id -> [views]
        self.rows = {}  # table_id -> [rows]
        self._next_id = 1

    def request(self, method, endpoint, data=None):
        data = copy.deepcopy(data) if data is not None else {}
        # Workspaces
        if endpoint == '/api/workspaces/':
            if method == 'GET':
                return copy.deepcopy(self.workspaces)
            if method == 'POST':
                ws = {'id': self._next_id, 'name': data['name']}
                self._next_id += 1
                self.workspaces.append(ws)
                return ws

        # Applications
        if endpoint.startswith('/api/applications/workspace/'):
            ws_id = int(endpoint.split('/')[4])
            if method == 'GET':
                return copy.deepcopy(self.apps.get(ws_id, []))
            if method == 'POST':
                app = {'id': self._next_id, 'name': data['name'], 'type': data['type']}
                self._next_id += 1
                self.apps.setdefault(ws_id, []).append(app)
                return app

        # Tables
        if endpoint.startswith('/api/database/tables/database/'):
            db_id = int(endpoint.split('/')[5])
            if method == 'GET':
                return copy.deepcopy(self.tables.get(db_id, []))
            if method == 'POST':
                t = {'id': self._next_id, 'name': data['name']}
                self._next_id += 1
                self.tables.setdefault(db_id, []).append(t)
                # Primary field created automatically in Baserow
                self.fields[t['id']] = [{'id': self._next_id, 'name': 'Name', 'primary': True, 'type': 'text'}]
                self._next_id += 1
                return t

        # Fields
        if endpoint.startswith('/api/database/fields/table/'):
            table_id = int(endpoint.split('/')[5])
            if method == 'GET':
                return copy.deepcopy(self.fields.get(table_id, []))
            if method == 'POST':
                field = {'id': self._next_id, **data, 'primary': False}
                self._next_id += 1
                self.fields.setdefault(table_id, []).append(field)
                return field

        if endpoint.startswith('/api/database/fields/') and method == 'PATCH':
            field_id = int(endpoint.split('/')[4])
            for t_fields in self.fields.values():
                for f in t_fields:
                    if f['id'] == field_id:
                        f.update(data)
                        return f

        # Views
        if endpoint.startswith('/api/database/views/table/'):
            table_id = int(endpoint.split('/')[5])
            if method == 'GET':
                return copy.deepcopy(self.views.get(table_id, []))
            if method == 'POST':
                v = {'id': self._next_id, **data}
                self._next_id += 1
                self.views.setdefault(table_id, []).append(v)
                return v

        # Rows
        if endpoint.startswith('/api/database/rows/table/'):
            table_id = int(endpoint.split('/')[5].split('?')[0])
            if method == 'GET':
                return {'count': len(self.rows.get(table_id, [])), 'results': copy.deepcopy(self.rows.get(table_id, []))}
            if method == 'POST':
                row = {'id': self._next_id, **data}
                self._next_id += 1
                self.rows.setdefault(table_id, []).append(row)
                return row

        raise ValueError(f"Unhandled endpoint in mock: {method} {endpoint}")


class KhoSchemaTest(unittest.TestCase):
    def test_schema_loads_valid_json(self):
        schema = kho_schema.load_schema()
        self.assertEqual(schema['database'], 'Kho Ryan')
        self.assertEqual(len(schema['tables']), 8)
        table_names = [t['name'] for t in schema['tables']]
        self.assertIn('Dự án', table_names)
        self.assertIn('Việc', table_names)
        self.assertIn('Phiên', table_names)
        self.assertIn('Quyết định', table_names)
        self.assertIn('Bài học', table_names)
        self.assertIn('Tri thức', table_names)
        self.assertIn('Tài sản', table_names)
        self.assertIn('Chỉ mục khóa', table_names)

        # Verify Claude's review point 3: Bảng Việc có 3 trường ngày
        viec_table = next(t for t in schema['tables'] if t['name'] == 'Việc')
        field_names = [f['name'] for f in viec_table['fields']]
        self.assertIn('Ngày tạo', field_names)
        self.assertIn('Ngày bắt đầu', field_names)
        self.assertIn('Ngày xong', field_names)

    def test_idempotent_sync_schema(self):
        client = MockBaserowClient()
        schema = kho_schema.load_schema()

        # Run 1: Should populate everything
        result1 = kho_schema.sync_schema(client, schema)
        self.assertIsNotNone(result1['workspace_id'])
        self.assertIsNotNone(result1['database_id'])
        self.assertEqual(len(result1['tables']), 8)

        # Count tables and fields after Run 1
        t_count_1 = len(client.tables[result1['database_id']])
        self.assertEqual(t_count_1, 8)
        fields_counts_1 = {t_id: len(f_list) for t_id, f_list in client.fields.items()}

        # Verify seed data inserted
        self.assertTrue(len(client.rows) > 0)
        rows_counts_1 = {t_id: len(r_list) for t_id, r_list in client.rows.items()}

        # Run 2: Second sync MUST NOT duplicate or error
        result2 = kho_schema.sync_schema(client, schema)
        t_count_2 = len(client.tables[result2['database_id']])
        self.assertEqual(t_count_2, t_count_1)
        fields_counts_2 = {t_id: len(f_list) for t_id, f_list in client.fields.items()}
        self.assertEqual(fields_counts_1, fields_counts_2)

        rows_counts_2 = {t_id: len(r_list) for t_id, r_list in client.rows.items()}
        self.assertEqual(rows_counts_1, rows_counts_2)


if __name__ == '__main__':
    unittest.main()
