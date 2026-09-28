#!/usr/bin/env python3
"""读取 Cavalry 原生 JSON 工程，报告节点分类、合成参数和字体定义。"""

import argparse
from collections import Counter
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", type=Path, help="要读取的 .cv 文件")
    parser.add_argument("--output", type=Path, help="JSON 报告；省略时写到标准输出")
    args = parser.parse_args()
    if args.output and args.output.resolve() == args.scene.resolve():
        parser.error("报告路径不能与输入工程相同")
    scene = json.loads(args.scene.read_text(encoding="utf-8"))
    nodes = scene["nodes"]
    counts = Counter(node["nodeType"] for node in nodes)
    compositions = []
    typefaces = []
    for node in nodes:
        if node["nodeType"] not in {"compNode", "typeface"}:
            continue
        attrs = {name: attr.get("value") for name, attr in node["attributes"].items()}
        if node["nodeType"] == "compNode":
            compositions.append({
                "id": node["nodeId"],
                **{name: attrs.get(name) for name in [
                    "niceName", "resolution", "fps", "startFrame", "endFrame", "playbackStart", "playbackEnd",
                ]},
            })
        elif node["nodeType"] == "typeface":
            typefaces.append({"id": node["nodeId"], "name": attrs.get("niceName"),
                              "font": attrs.get("font")})
    report = {
        "scene": str(args.scene.resolve()), "version": scene.get("version"),
        "active_comp": scene.get("activeComp"), "total_nodes": len(nodes),
        "connection_count": len(scene["connections"]),
        "node_type_counts": dict(sorted(counts.items())),
        "compositions": compositions, "typefaces": typefaces,
        "scope": "文件中保存的结构。不是应用当前求值、字体可用性或原生渲染证明。未保存的属性用 null 表示。",
    }
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
        print(args.output.resolve())
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
