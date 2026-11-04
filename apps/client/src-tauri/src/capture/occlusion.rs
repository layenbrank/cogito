//! 候选窗口的可见性判定（近似）。
//!
//! 为什么需要：`EnumWindows` 给出的是**所有**可见顶层窗口（按 z 序），包括被上层窗口
//! 完全盖住的那些。前端 `findHoverStack` 只做矩形命中，于是滚轮能选到屏幕上根本看不见的
//! 窗口 —— 用户要的「只识别前台可见的窗口」就落在这里。
//!
//! 为什么不用精确裁剪：逐窗做多边形差集要处理任意形状、圆角、异形窗口，成本高收益低；
//! 48px 网格在 1x / 1.5x / 2x 缩放下误差都小于半个常控件尺寸，足以决定「进不进候选」。

/// 覆盖网格单元边长（物理像素）
pub const CELL_PX: i32 = 48;
/// 可见比例低于该值就不进候选（只剩一条边或一条缝，选了也没用）
pub const MIN_VISIBLE_RATIO: f32 = 0.15;

/// 与 Win32 `RECT` 解耦的矩形（便于单测）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Box2 {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Box2 {
    pub fn width(&self) -> i32 {
        (self.right - self.left).max(0)
    }

    pub fn height(&self) -> i32 {
        (self.bottom - self.top).max(0)
    }

    pub fn is_empty(&self) -> bool {
        self.width() <= 0 || self.height() <= 0
    }

    /// 交集是否非空
    pub fn intersects(&self, other: &Box2) -> bool {
        self.left < other.right
            && other.left < self.right
            && self.top < other.bottom
            && other.top < self.bottom
    }
}

/// 覆盖网格：记录「已经被更高 z 序窗口盖住」的单元格
pub struct CoverageGrid {
    left: i32,
    top: i32,
    cols: i32,
    rows: i32,
    covered: Vec<bool>,
}

impl CoverageGrid {
    pub fn new(left: i32, top: i32, width: i32, height: i32) -> Self {
        let cols = (width.max(0) + CELL_PX - 1) / CELL_PX;
        let rows = (height.max(0) + CELL_PX - 1) / CELL_PX;
        let cells = (cols.max(0) as usize) * (rows.max(0) as usize);
        Self {
            left,
            top,
            cols,
            rows,
            covered: vec![false; cells],
        }
    }

    /// 把矩形在网格里的列/行区间求出来（已夹到网格内）
    fn cell_range(&self, area: &Box2) -> Option<(i32, i32, i32, i32)> {
        if self.cols <= 0 || self.rows <= 0 || area.is_empty() {
            return None;
        }
        let col_start = ((area.left - self.left) / CELL_PX).max(0);
        let row_start = ((area.top - self.top) / CELL_PX).max(0);
        let col_end = ((area.right - self.left + CELL_PX - 1) / CELL_PX).min(self.cols);
        let row_end = ((area.bottom - self.top + CELL_PX - 1) / CELL_PX).min(self.rows);
        if col_end <= col_start || row_end <= row_start {
            return None;
        }
        Some((col_start, col_end, row_start, row_end))
    }

    /// 矩形里**未被覆盖**的单元格比例（0.0~1.0）。
    ///
    /// 网格退化（监视器尺寸为 0 等）时返回 1.0：宁可多给候选，也不能把所有窗口都判死。
    pub fn visible_ratio(&self, area: &Box2) -> f32 {
        if self.cols <= 0 || self.rows <= 0 {
            return 1.0;
        }
        let Some((col_start, col_end, row_start, row_end)) = self.cell_range(area) else {
            // 完全落在监视器外：没有任何可见面积
            return 0.0;
        };
        let mut total = 0usize;
        let mut visible = 0usize;
        for row in row_start..row_end {
            for col in col_start..col_end {
                total += 1;
                let index = (row as usize) * (self.cols.max(0) as usize) + col as usize;
                if !self.covered.get(index).copied().unwrap_or(false) {
                    visible += 1;
                }
            }
        }
        if total == 0 {
            return 0.0;
        }
        visible as f32 / total as f32
    }

    /// 把矩形标记为已覆盖（调用方按 z 序从顶到底推进）
    pub fn cover(&mut self, area: &Box2) {
        let Some((col_start, col_end, row_start, row_end)) = self.cell_range(area) else {
            return;
        };
        for row in row_start..row_end {
            for col in col_start..col_end {
                let index = (row as usize) * (self.cols.max(0) as usize) + col as usize;
                if let Some(cell) = self.covered.get_mut(index) {
                    *cell = true;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid() -> CoverageGrid {
        // 1920x1080 的监视器，覆盖 40x23 个单元
        CoverageGrid::new(0, 0, 1920, 1080)
    }

    fn full_screen() -> Box2 {
        Box2 {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        }
    }

    fn window(left: i32, top: i32, right: i32, bottom: i32) -> Box2 {
        Box2 {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn fully_covered_window_is_invisible() {
        let mut grid = grid();
        assert_eq!(grid.visible_ratio(&full_screen()), 1.0);
        grid.cover(&full_screen());
        // 全屏窗口盖住之后，它下面的窗口一个可见单元都没有
        let behind = window(100, 100, 900, 700);
        assert_eq!(grid.visible_ratio(&behind), 0.0);
        assert!(grid.visible_ratio(&behind) < MIN_VISIBLE_RATIO);
    }

    #[test]
    fn half_covered_window_keeps_its_candidates() {
        let mut grid = grid();
        // 左半边被盖住，右半边可见 → 比例约 0.5，应保留
        grid.cover(&window(0, 0, 960, 1080));
        let half = window(0, 0, 1920, 1080);
        let ratio = grid.visible_ratio(&half);
        assert!(ratio > 0.4 && ratio < 0.6, "实际比例: {ratio}");
        assert!(ratio >= MIN_VISIBLE_RATIO);
    }

    #[test]
    fn same_rect_stack_keeps_only_topmost() {
        let mut grid = grid();
        let rect = window(200, 200, 1200, 900);
        assert!(grid.visible_ratio(&rect) > MIN_VISIBLE_RATIO);
        grid.cover(&rect);
        // 完全同矩形的下一层：一个可见单元都不剩
        assert_eq!(grid.visible_ratio(&rect), 0.0);
    }

    #[test]
    fn off_screen_window_has_no_visible_area() {
        let grid = grid();
        let off = window(4000, 4000, 4600, 4600);
        assert_eq!(grid.visible_ratio(&off), 0.0);
    }
}
