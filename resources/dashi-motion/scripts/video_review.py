#!/usr/bin/env python3
"""顺序解码视频，按真实时间戳抽帧，生成单片或并排联系图。"""

import argparse
import json
from pathlib import Path
import subprocess

import cv2
from PIL import Image, ImageDraw, ImageOps


def probe(path):
    metadata = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=index,codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames",
        "-of", "json", str(path),
    ], text=True))
    frames = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "frame=best_effort_timestamp_time", "-of", "json", str(path),
    ], text=True))["frames"]
    timestamps = [float(frame["best_effort_timestamp_time"]) for frame in frames]
    origin = timestamps[0]
    return metadata, origin, [time - origin for time in timestamps]


def decode_samples(path, timestamps, requested):
    for time in requested:
        if not 0 <= time <= timestamps[-1]:
            raise ValueError(f"{path.name}: {time}s 超出帧时间范围 0–{timestamps[-1]}s")
    indices = [min(range(len(timestamps)), key=lambda i: abs(timestamps[i] - time))
               for time in requested]
    wanted = set(indices)
    samples = {}
    capture = cv2.VideoCapture(str(path), cv2.CAP_FFMPEG)
    if not capture.isOpened():
        raise ValueError(f"无法打开视频：{path}")
    count = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if count in wanted:
                samples[count] = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            count += 1
    finally:
        capture.release()
    if count != len(timestamps):
        raise ValueError(f"{path.name}: OpenCV 解码 {count} 帧，ffprobe 返回 {len(timestamps)} 帧；先检查解码结果")
    return count, indices, samples


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path, help="第一份视频")
    parser.add_argument("--compare", type=Path, help="要并排比较的第二份视频")
    parser.add_argument("--times", nargs="+", type=float, required=True, help="相对第一帧的秒数")
    parser.add_argument("--compare-offset", type=float, default=0,
                        help="第二份视频取样时间 = --times + 此偏移，单位秒")
    parser.add_argument("--out-dir", type=Path, required=True, help="本次报告和抽帧输出目录")
    args = parser.parse_args()
    videos = [args.video] + ([args.compare] if args.compare else [])
    report = {"requested_seconds": args.times, "videos": []}
    columns = []
    for side, path in enumerate(videos):
        metadata, origin, timestamps = probe(path)
        requested = [time + (args.compare_offset if side else 0) for time in args.times]
        count, indices, samples = decode_samples(path, timestamps, requested)
        columns.append([samples[index] for index in indices])
        report["videos"].append({
            "path": str(path.resolve()), "metadata": metadata,
            "decoded_frames": count, "first_pts_seconds": origin,
            "frame_seconds": timestamps,
            "samples": [{"requested_seconds": time, "frame_index": index,
                         "actual_seconds": timestamps[index],
                         "time_error_seconds": timestamps[index] - time}
                        for time, index in zip(requested, indices)],
        })

    args.out_dir.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGB", (480 * len(columns), 398 * len(args.times)), "#242424")
    draw = ImageDraw.Draw(sheet)
    for side, frames in enumerate(columns):
        for row, frame in enumerate(frames):
            filename = f"video-{side + 1}-sample-{row + 1:02}.png"
            frame.save(args.out_dir / filename)
            sample = report["videos"][side]["samples"][row]
            sample["image"] = filename
            thumbnail = ImageOps.contain(frame, (480, 360))
            x = side * 480 + (480 - thumbnail.width) // 2
            y = row * 398 + 38 + (360 - thumbnail.height) // 2
            sheet.paste(thumbnail, (x, y))
            draw.text((side * 480 + 10, row * 398 + 10),
                      f"Video {side + 1} | frame {sample['frame_index']} | {sample['actual_seconds']:.4f}s",
                      fill="white")
    sheet.save(args.out_dir / "contact-sheet.png")
    (args.out_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.out_dir.resolve()),
                      "decoded_frames": [video["decoded_frames"] for video in report["videos"]]},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
