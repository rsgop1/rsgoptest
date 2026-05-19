export function layout(title: string, body: string, user?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Testbook+ Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen">
  <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
    <div class="flex items-center gap-6">
      <span class="text-blue-400 font-bold text-lg">📚 Testbook+ Admin</span>
      ${user ? `
      <a href="/admin/dashboard" class="text-sm text-gray-300 hover:text-white transition">Dashboard</a>
      <a href="/admin/payments" class="text-sm text-gray-300 hover:text-white transition">Payments</a>
      <a href="/admin/import" class="text-sm text-gray-300 hover:text-white transition">Import Tests</a>
      <a href="/admin/settings" class="text-sm text-gray-300 hover:text-white transition">Settings</a>
      ` : ""}
    </div>
    ${user ? `<a href="/admin/logout" class="text-sm text-red-400 hover:text-red-300">Logout</a>` : ""}
  </nav>
  <main class="max-w-6xl mx-auto px-6 py-8">
    ${body}
  </main>
</body>
</html>`;
}

export function statCard(label: string, value: string | number, color = "blue"): string {
  const colors: Record<string, string> = {
    blue: "border-blue-500 text-blue-400",
    green: "border-green-500 text-green-400",
    yellow: "border-yellow-500 text-yellow-400",
    purple: "border-purple-500 text-purple-400",
    red: "border-red-500 text-red-400",
  };
  const cls = colors[color] ?? colors["blue"]!;
  return `
    <div class="bg-gray-900 rounded-xl border-l-4 ${cls.split(" ")[0]} p-5">
      <p class="text-gray-400 text-sm mb-1">${label}</p>
      <p class="text-2xl font-bold ${cls.split(" ")[1]}">${value}</p>
    </div>`;
}

export function alert(msg: string, type: "success" | "error"): string {
  const cls = type === "success"
    ? "bg-green-900 border-green-500 text-green-200"
    : "bg-red-900 border-red-500 text-red-200";
  return `<div class="border rounded-lg p-4 mb-6 ${cls}">${msg}</div>`;
}
