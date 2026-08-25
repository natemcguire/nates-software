import { Cpu, Database, Download, ShieldCheck } from 'lucide-react';

export const RigRuntimeView: React.FC = () => {
  return (
    <div className="grid grid-cols-12 gap-3 h-full overflow-hidden font-tahoma text-xs">
      {/* Left: Active Dynos Table */}
      <div className="col-span-7 bg-white border-2 border-gray-800 p-3 flex flex-col overflow-y-auto">
        <div className="border-b pb-2 mb-2 flex items-center justify-between">
          <span className="font-bold text-sm text-w95-blue flex items-center gap-1.5">
            <Cpu size={16} className="text-green-700" /> RIG.EXE Micro-Dyno Manager
          </span>
          <span className="bg-green-100 text-green-800 text-[10px] px-2 py-0.5 rounded font-bold font-mono">
            ● 2 Containers Online
          </span>
        </div>

        <table className="w-full border-collapse text-xs mb-3">
          <thead>
            <tr className="bg-w95-blue text-white text-left">
              <th className="p-1.5">App / Fork</th>
              <th className="p-1.5">Port</th>
              <th className="p-1.5">Memory</th>
              <th className="p-1.5">SQLite Storage</th>
              <th className="p-1.5">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b hover:bg-gray-50">
              <td className="p-1.5 font-bold">nate/retro-calc</td>
              <td className="p-1.5 font-mono">3001</td>
              <td className="p-1.5 text-green-700 font-bold">24 MB</td>
              <td className="p-1.5 font-mono">/data/app.sqlite (1.4MB)</td>
              <td className="p-1.5">
                <span className="btn-w95 text-[10px]">Restart</span>
              </td>
            </tr>
            <tr className="border-b hover:bg-gray-50">
              <td className="p-1.5 font-bold">nate/sailtrack</td>
              <td className="p-1.5 font-mono">3002</td>
              <td className="p-1.5 text-green-700 font-bold">38 MB</td>
              <td className="p-1.5 font-mono">/data/app.sqlite (4.2MB)</td>
              <td className="p-1.5">
                <span className="btn-w95 text-[10px]">Restart</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Runtime Guarantees */}
        <div className="bg-gray-50 border border-gray-300 p-2.5 rounded space-y-1.5">
          <div className="font-bold text-gray-800 flex items-center gap-1">
            <ShieldCheck size={14} className="text-green-700" /> Sovereign Single-File SQLite Guarantee:
          </div>
          <p className="text-gray-600 text-[11px] leading-relaxed">
            Your data is never trapped in a multi-tenant cloud database. It lives in a single, un-locked <code className="bg-gray-200 px-1 font-mono">.sqlite</code> file with continuous Litestream replication to Cloudflare R2.
          </p>
        </div>
      </div>

      {/* Right: Storage & Backup Tools */}
      <div className="col-span-5 bg-white border-2 border-gray-800 p-3 flex flex-col overflow-y-auto">
        <div className="border-b pb-2 mb-2">
          <span className="font-bold text-sm text-w95-blue flex items-center gap-1.5">
            <Database size={16} className="text-blue-700" /> Database & Crash Recovery
          </span>
        </div>

        <div className="space-y-3">
          <div className="bg-blue-50 border border-w95-blue p-2.5 rounded">
            <div className="font-bold text-w95-blue mb-1">Instant Data Backup</div>
            <p className="text-gray-600 text-[11px] mb-2">
              Export your live SQLite database file to your local computer in one click.
            </p>
            <button className="btn-w95 btn-w95-primary w-full py-1 flex items-center justify-center gap-1">
              <Download size={12} /> Download retro-calc.sqlite
            </button>
          </div>

          <div className="bg-yellow-50 border border-yellow-500 p-2.5 rounded">
            <div className="font-bold text-yellow-900 mb-1">OOM (Exit 137) Auto-Recovery</div>
            <p className="text-gray-700 text-[11px]">
              Memory cap: 256MB. If user code leaks memory, RIG safely checkpoints SQLite and dispatches a stack trace to INBOX.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
