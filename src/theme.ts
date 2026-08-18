import { createTheme, type MantineColorsTuple } from "@mantine/core";

const nanoBlue: MantineColorsTuple = [
  "#edf8ff",
  "#d7efff",
  "#adddff",
  "#7cc9ff",
  "#55b8ff",
  "#3aafff",
  "#269df2",
  "#1689da",
  "#0878c4",
  "#0068ae"
];

export const nanoTheme = createTheme({
  primaryColor: "nanoBlue",
  colors: {
    nanoBlue
  },
  defaultRadius: "md",
  fontFamily: '"Manrope", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  headings: {
    fontFamily: '"Manrope", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    fontWeight: "650"
  },
  cursorType: "pointer",
  components: {
    Button: {
      defaultProps: {
        radius: "md",
        size: "sm"
      }
    },
    ActionIcon: {
      defaultProps: {
        radius: "md",
        size: "md",
        variant: "subtle",
        color: "gray"
      }
    },
    Modal: {
      defaultProps: {
        radius: "lg",
        centered: true,
        overlayProps: {
          backgroundOpacity: 0.48,
          blur: 2
        }
      }
    }
  }
});
