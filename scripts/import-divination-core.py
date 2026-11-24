"""Compile the reviewed Guaji calculation modules to browser JavaScript.

Usage: python scripts/import-divination-core.py <ai-divination directory>
Requires Transcrypt 3.9.5 and Node. The scratch tree intentionally contains
only calculation code, with the original server and provider layers removed.
"""

import ast
import json
import os
import re
from pathlib import Path
import subprocess
import sys
from datetime import datetime

REPO = Path(__file__).resolve().parents[1]
SCRATCH = REPO / "standalone/.build-cache/divination-core"
DEST = REPO / "standalone/src/divination"
CORE = (
    "bagua", "bayes", "contract", "formulas", "ganzhi", "gua_interpret",
    "hypotheses", "manifests", "najia", "qigua", "recognize", "steps", "wuxing",
    "shushu/liuyao", "shushu/meihua", "shushu/qimen",
    "shushu/xiaoliuren", "shushu/zhouyi",
)


def without_model_call(source: str) -> str:
    """Remove the optional model call, leaving offline behavior intact."""
    lines = source.splitlines(keepends=True)
    nodes = [
        node for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.If)
        and ast.get_source_segment(source, node.test).startswith("use_llm and")
    ]
    for node in sorted(nodes, key=lambda n: n.lineno, reverse=True):
        del lines[node.lineno - 1:node.end_lineno]
    return "".join(lines)


def stage(original: Path) -> None:
    for package in ("app", "app/core", "app/core/shushu"):
        folder = SCRATCH / package
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "__init__.py").write_text("", encoding="utf-8")
    for name in CORE:
        path = f"app/core/{name}.py"
        contents = (original / path).read_text(encoding="utf-8-sig")
        if name == "recognize":
            contents = without_model_call(contents)
        (SCRATCH / path).write_text(contents, encoding="utf-8")
    pipeline = without_model_call((original / "app/pipeline.py").read_text(encoding="utf-8-sig"))
    pipeline = pipeline.replace("from .config import settings\n", "").replace("from .llm import client as llm\n", "")
    pipeline = pipeline.replace("Optional[llm.LLMClient]", "Optional[object]").replace('getattr(settings, "kappa", formulas.KAPPA)', "formulas.KAPPA")
    (SCRATCH / "app/pipeline.py").write_text(pipeline, encoding="utf-8")


def fixtures() -> None:
    sys.path.insert(0, str(SCRATCH))
    from app.core.manifests import all_combos, catalog
    from app.core.recognize import recognize
    from app.pipeline import divine, compute_shushu_scores
    cases = []
    for date in ("2026-11-25T23:10:05", "2000-02-04T00:15:00", "2024-02-29T13:30:00"):
        for shushu, method in all_combos():
            inputs = {"question": "角色是否应在明天离开邮局？", "category": "", "shushu": shushu,
                      "method": method, "seed": "studio-reference", "timestamp": date}
            if method == "number":
                inputs["numbers"] = [8, 5, 12]
            args = {key: value for key, value in inputs.items() if key != "timestamp"}
            result = divine(**args, dt=datetime.fromisoformat(date), use_llm=False)
            cases.append({"input": inputs, "result": result})
    for coins in ([[3, 2, 2]] * 6, [[2, 2, 2], [3, 3, 3]] * 3):
        inputs = {"question": "故事下一幕", "shushu": "liuyao", "method": "coin", "coins": coins,
                  "seed": "studio-reference", "timestamp": "2026-05-05T09:00:00"}
        args = {key: value for key, value in inputs.items() if key != "timestamp"}
        cases.append({"input": inputs, "result": divine(**args, dt=datetime.fromisoformat(inputs["timestamp"]), use_llm=False)})
    cross = {"question": "是否换一条路线？", "timestamp": "2026-11-25T18:00:00", "seed": "cross"}
    recognized = [{"input": question, "result": recognize(question).to_dict()} for question in (
        "铜钱摇卦，问写作", "梅花报数 8 5 12", "大衍筮法", "什么时候能推进", "用月将加时"
    )]
    out = {"cases": cases, "recognize": recognized, "manifests": catalog(), "cross": {"input": cross,
           "result": compute_shushu_scores(cross["question"], dt=datetime.fromisoformat(cross["timestamp"]), seed=cross["seed"])}}
    (SCRATCH / "oracle.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")


def prepare_compiler() -> None:
    class BrowserClasses(ast.NodeTransformer):
        def visit_FormattedValue(self, node):
            self.generic_visit(node)
            if node.format_spec is not None:
                spec = node.format_spec.values[0]
                node.value = ast.Call(func=ast.Name(id="format_number", ctx=ast.Load()), args=[node.value, spec], keywords=[])
                node.format_spec = None
            return node

        def visit_Call(self, node):
            self.generic_visit(node)
            name = getattr(node.func, "id", "")
            if name == "enumerate":
                return ast.Call(func=ast.Name(id="list", ctx=ast.Load()), args=[node], keywords=[])
            if name == "next":
                node.func.id = "studio_first"
            if name == "round":
                node.func.id = "number_round"
            if name == "dict" and node.keywords:
                contents = ast.Dict(keys=[ast.Constant(key.arg) if key.arg is not None else None for key in node.keywords],
                                    values=[key.value for key in node.keywords])
                return self.visit_Dict(contents)
            return node

        def visit_GeneratorExp(self, node):
            self.generic_visit(node)
            return ast.ListComp(elt=node.elt, generators=node.generators)

        def visit_AnnAssign(self, node):
            if node.value is None:
                return None
            return ast.Assign(targets=[node.target], value=self.visit(node.value))

        def visit_Dict(self, node):
            self.generic_visit(node)
            if None not in node.keys:
                return node
            parts = [value if key is None else ast.Dict(keys=[key], values=[value])
                     for key, value in zip(node.keys, node.values)]
            return ast.Call(func=ast.Name(id="studio_merge", ctx=ast.Load()), args=parts, keywords=[])

        def visit_ClassDef(self, node):
            if not any(isinstance(decorator, ast.Name) and decorator.id == "dataclass"
                       or isinstance(decorator, ast.Call) and getattr(decorator.func, "id", "") == "dataclass"
                       for decorator in node.decorator_list):
                return node
            fields = [field for field in node.body if isinstance(field, ast.AnnAssign)]
            args = [field.target.id for field in fields]
            defaults = [field.value for field in fields if field.value is not None]
            constructor = ast.parse("def __init__(self, " + ", ".join(args) + "):\n" +
                                    "\n".join("    self." + arg + " = " + arg for arg in args)).body[0]
            constructor.args.defaults = defaults
            node.decorator_list = []
            node.body = [part for part in node.body if part not in fields] + [constructor]
            return node

    for path in (SCRATCH / "app").rglob("*.py"):
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
        contents = "".join(line for line in lines if not line.startswith(("from typing import ", "Coef = ", "from dataclasses import ")))
        package = path.relative_to(SCRATCH).parts[:-1]
        def absolute_import(match):
            indent, dots, module = match.groups()
            return indent + "from " + ".".join((*package[:len(package) - len(dots) + 1], module)) + " import "
        contents = re.sub(r"^([ \t]*)from (\.+)(\w+(?:\.\w+)*) import ", absolute_import, contents, flags=re.M)
        if path.name == "pipeline.py":
            def module_imports(match):
                imports = []
                for clause in match[2].split(","):
                    name, _, alias = clause.strip().partition(" as ")
                    imports.append("import " + match[1] + "." + name + " as " + (alias or name))
                return "\n".join(imports)
            contents = re.sub(r"^from (app\.core(?:\.shushu)?) import ([a-z_, ]+)$", module_imports, contents, flags=re.M)
        if path.name == "contract.py":
            contents = contents.replace("field(default_factory=dict)", "None").replace("field(default_factory=list)", "None")
            contents = contents.replace("for e in self.evidence]", "for e in (self.evidence or [])]")
            contents = contents.replace('"detail": self.detail', '"detail": self.detail or {}')
        contents = contents.replace("from datetime import ", "from studio_time import ")
        contents = contents.replace("import math\n", "import studio_math as math\n")
        if path.name == "bayes.py":
            contents = contents.replace("keys = set(p) | set(q)", "keys = set(list(p.keys()) + list(q.keys()))")
        contents = ast.unparse(ast.fix_missing_locations(BrowserClasses().visit(ast.parse(contents)))) + "\n"
        helpers = [name for name in ("number_round", "format_number") if name + "(" in contents]
        if helpers:
            contents = "from studio_math import " + ", ".join(helpers) + "\n" + contents
        if "studio_merge(" in contents:
            contents += "\ndef studio_merge(*parts):\n    merged = {}\n    for part in parts:\n        merged.update(part)\n    return merged\n"
        if "studio_first(" in contents:
            contents += "\ndef studio_first(items, missing=None):\n    return items[0] if items else missing\n"
        path.write_text(contents, encoding="utf-8")
    # Recognition only needs compile/findall after the old LLM fallback is removed.
    (SCRATCH / "studio_regex.py").write_text("I = 2\n"
        "def compile(pattern, flags=0):\n"
        "    __pragma__('js', '{}', '''return { findall: (value) => String(value).match(new RegExp(pattern, flags ? \"gi\" : \"g\")) || [], search: (value) => new RegExp(pattern, flags ? \"i\" : \"\").test(value), sub: (replacement, value) => value.replace(new RegExp(pattern, flags ? \"gi\" : \"g\"), replacement) };''')\n",
        encoding="utf-8")
    qigua = SCRATCH / "app/core/qigua.py"
    code = qigua.read_text(encoding="utf-8").replace("import hashlib\nimport random\n", "from studio_rng import seeded\n")
    code = code.replace(" -> random.Random:", ":")
    code = re.sub(r"    h = hashlib\.sha256.*\n    return random\.Random[^\n]*", "    return seeded(seed)", code)
    code = code.replace("rng: random.Random", "rng")
    qigua.write_text(code, encoding="utf-8")
    recognize = SCRATCH / "app/core/recognize.py"
    recognition = recognize.read_text(encoding="utf-8").replace("import json\n", "")
    recognition = recognition.replace("import re\n", "import studio_regex as re\n")
    recognition = recognition.replace("(best_shushu, best_method), s1 = ranked[0]",
                                      "best, s1 = ranked[0]\n    best_shushu, best_method = best.split(',')")
    recognize.write_text(recognition, encoding="utf-8")
    (SCRATCH / "studio_rng.py").write_text("def seeded(seed):\n"
        "    __pragma__('js', '{}', 'return pythonRandom(seed);')\n", encoding="utf-8")
    math = "\n".join(f"def {name}(value):\n    __pragma__('js', '{{}}', 'return {js}(value);')\n"
        for name, js in {"exp": "Math.exp", "log": "Math.log", "log2": "Math.log2", "isfinite": "Number.isFinite"}.items())
    math += """
def fixed(value, digits):
    __pragma__('js', '{}', '''
        const magnitude = Math.abs(value);
        const midpoint = magnitude * 2 ** (digits + 1);
        if (Number.isSafeInteger(midpoint) && midpoint % 2 === 1) {
            const whole = (midpoint * 5 ** digits - 1) / 2;
            if (whole % 2 === 0) return (whole / 10 ** digits).toFixed(digits);
        }
        return magnitude.toFixed(digits);
    ''')
def number_round(value, digits=0):
    __pragma__('js', '{}', 'return Number(fixed(value, digits)) * (value < 0 ? -1 : 1);')
def format_number(value, spec):
    __pragma__('js', '{}', '''
        const digits = Number(spec.match(/\\.(\\d+)/)?.[1] || 0);
        const negative = value < 0 || Object.is(value, -0);
        return (negative ? '-' : spec.startsWith('+') ? '+' : '') + fixed(value, digits);
    ''')
"""
    (SCRATCH / "studio_math.py").write_text(math, encoding="utf-8")
    (SCRATCH / "studio_time.py").write_text("""def datetime(year, month, day, hour=0, minute=0, second=0):
    __pragma__('js', '{}', '''
        const pad = (value, length = 2) => String(value).padStart(length, '0');
        const fields = { Y: pad(year, 4), m: pad(month), d: pad(day), H: pad(hour), M: pad(minute), S: pad(second) };
        const strftime = (pattern) => pattern.replace(/%([YmdHMS])/g, (_, key) => fields[key]);
        return { year, month, day, hour, minute, second, date: () => ({ year, month, day }),
          strftime, isoformat: () => strftime('%Y-%m-%dT%H:%M:%S') };
    ''')
date = datetime
""", encoding="utf-8")
    (SCRATCH / "entry.py").write_text(
        "from studio_time import datetime\n"
        "from app.pipeline import divine, compute_shushu_scores\n"
        "from app.core.recognize import recognize\n"
        "from app.core.manifests import catalog\n"
        "from app.core.gua_interpret import catalog as gua_catalog\n"
        "from app.core.formulas import FORMULAS\n"
        "from app.core.hypotheses import HYPOTHESIS_SPACE\n"
        "def civil_time(timestamp):\n"
        "    return datetime(int(timestamp[:4]), int(timestamp[5:7]), int(timestamp[8:10]), int(timestamp[11:13]), int(timestamp[14:16]), int(timestamp[17:19]))\n"
        "def run_cast(question, category, system, method, timestamp, seed, numbers, coins):\n"
        "    return divine(question, category, system, civil_time(timestamp), method, seed, numbers, coins, False)\n"
        "def run_cross(question, category, timestamp, seed):\n"
        "    return compute_shushu_scores(question, category, civil_time(timestamp), seed)\n"
        "def run_recognize(question, numbers, system, method):\n"
        "    return recognize(question, numbers, system, method).to_dict()\n"
        "def get_meta():\n"
        "    return {'manifests': catalog(), 'gua64': gua_catalog(), 'formulas': {key: value.to_dict() for key, value in FORMULAS.items()}, 'categories': [{'key': key, 'label': value['label']} for key, value in HYPOTHESIS_SPACE.items()]}\n",
        encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    DEST.mkdir(parents=True, exist_ok=True)
    stage(Path(sys.argv[1]).resolve())
    fixtures()
    prepare_compiler()
    subprocess.run([sys.executable, "-B", "-m", "transcrypt", "-b", "-n", "-k", "-o", "-t", "-i", "-sf", "entry.py"],
                   cwd=SCRATCH, check=True)
    output = SCRATCH / "__target__/studio_rng.js"
    rng_path = Path(os.path.relpath(DEST / "python-random.js", output.parent)).as_posix()
    output.write_text("import { pythonRandom } from " + json.dumps(rng_path) + ";\n"
                      + output.read_text(encoding="utf-8"), encoding="utf-8")
    subprocess.run(["node", str(REPO / "scripts/bundle-divination-core.mjs")], cwd=REPO, check=True)
