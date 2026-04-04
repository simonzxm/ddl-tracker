#!/usr/bin/env python3
"""
将教务系统导出的CSV转换为ddl-tracker可导入的格式。

源CSV字段：
- KCH: 课程号
- KCM: 课程名
- JXBMC: 教学班名称
- SKJS: 授课教师
- XXXQDM_DISPLAY: 校区
- YPSJDD: 时间地点
- XNXQDM_DISPLAY: 学期显示名称

目标CSV格式：
课号,课程名,简称,教师,学期,班级名称,校区,时间地点
"""

import csv
import sys
import re
from pathlib import Path


def convert_csv(input_path: str, output_path: str = None):
    """
    转换CSV文件。
    
    Args:
        input_path: 输入文件路径
        output_path: 输出文件路径，默认为 {input_name}_import.csv
    """
    input_file = Path(input_path)
    if output_path is None:
        output_path = input_file.parent / f"{input_file.stem}_import.csv"
    
    # 读取源CSV
    with open(input_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    # 转换并写入
    output_rows = []
    seen = set()  # 用于去重
    
    for row in rows:
        course_code = row.get('KCH', '').strip()
        name = row.get('KCM', '').strip()
        class_name = row.get('JXBMC', '').strip()
        teacher = row.get('SKJS', '').strip()
        campus = row.get('XXXQDM_DISPLAY', '').strip()
        time_location = row.get('YPSJDD', '').strip()
        semester = row.get('XNXQDM_DISPLAY', '').strip()
        
        # 跳过空行
        if not course_code or not name or not teacher:
            print(f"警告: 跳过缺少必要字段的行 - 课程号: '{course_code}', 课程名: '{name}', 教师: '{teacher}'")
            continue
        
        # 去重键：课号+教师+学期+班级名称
        key = (course_code, teacher, semester, class_name)
        if key in seen:
            continue
        seen.add(key)
        
        output_rows.append({
            'code': course_code,
            'name': name,
            'name_abbr': '',  # 简称留空
            'teacher': teacher,
            'semester': semester,
            'class_name': class_name,
            'campus': campus,
            'time_location': time_location,
        })
    
    # 写入输出CSV
    fieldnames = ['code', 'name', 'name_abbr', 'teacher', 'semester', 'class_name', 'campus', 'time_location']
    with open(output_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        # 不写header，因为admin页面的CSV导入不需要header行
        for row in output_rows:
            writer.writerow(row)
    
    print(f"转换完成！")
    print(f"  输入: {input_path}")
    print(f"  输出: {output_path}")
    print(f"  共计: {len(output_rows)} 条课程记录")


def main():
    if len(sys.argv) < 2:
        print("用法: python convert_courses.py <输入CSV> [输出CSV]")
        print("示例: python convert_courses.py 2026-Spring.csv")
        print("      python convert_courses.py 2026-Spring.csv output.csv")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    if not Path(input_path).exists():
        print(f"错误: 文件不存在 - {input_path}")
        sys.exit(1)
    
    convert_csv(input_path, output_path)


if __name__ == '__main__':
    main()
