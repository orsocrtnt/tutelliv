import React from "react";

type Column<T> = {
  header: string;
  accessor: keyof T;
  className?: string; // optionnel
};

type TableProps<T> = {
  columns: Column<T>[];
  data: T[];
};

export default function Table<T extends { id: string | number }>({
  columns,
  data,
}: TableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-lg shadow">
      <table className="min-w-full bg-white text-sm">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.header}
                className={`px-3 sm:px-4 py-2 text-left font-semibold text-gray-700 border-b ${col.className || ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50">
              {columns.map((col) => (
                <td
                  key={String(col.accessor)}
                  className={`px-3 sm:px-4 py-2 text-gray-700 border-b align-top ${col.className || ""}`}
                >
                  {String(row[col.accessor])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
