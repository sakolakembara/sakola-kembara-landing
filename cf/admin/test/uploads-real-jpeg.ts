// A small, real JPEG (40 x 24, baseline, restart interval, JFIF header, no Exif, no colour profile) written by an
// ordinary encoder (macOS `sips`, quality 80) from a synthetic gradient with noise, and cleaned of the metadata
// that encoder adds. No real photo is involved. 1285 bytes. The upload tests put invented
// metadata into it and expect exactly these bytes back.
export const CLEAN_JPEG_BASE64 = [
  "/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAAYACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA",
  "AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4",
  "eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEB",
  "AQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygp",
  "KjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX",
  "2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBAMDAwQFBAQEBAUHBQUFBQUHCAcHBwcHBwgICAgICAgICgoKCgoKCwsLCwsNDQ0NDQ0NDQ0N",
  "/9sAQwECAgIDAwMGAwMGDQkHCQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0N/90ABAAD/9oADAMBAAIRAxEAPwD5",
  "k8P/AA2v14G5cFoxI/GMkZK5PzkYJz16dOldgfAWpQwrEYXYoflAJbblSchsckggj3B+tfo1ovw1sHhU28RPyrIDsJwN20kDd1Pf15O6tqf4dWDQ+UsQLl2U",
  "A/MF2jg46nseRkBfoK/lrjvjXF5TmDnBaXP6b4C8ffaZUr9j8mtV+Ht/EpBQjywGGFZWGBgbuoUdTySO5xmvLtT8A3rSKYVdUlY5CEqpYkDOeTwc4A64HGDz",
  "+t2vfDq1AkMgEg2ltyHndlWOCSADyMY4I59q8cvPAunzXILhlJ3RhlOz7qqcjI+YnHU9uuflFfvfgr9KKrhZRpVZH8jePfjY5VJNH522nwzug4jkjcjADSPu",
  "2fNuw2Mg/eONxzgZz6nT/wCFUy/89of++m/+Kr9BtI8Daf5gi8tVWFxgsRkAMAMDHHB+YH6k5HPbf8IVpv8Az0i/Nf8AGv7mw30gcLiqUaze5/MmW+OM40be",
  "Z//Q+u9F+I1m8KHAjHD7mChivJXOM8huTnoevetK++INqbRjIyMshJAdmPBOQoYcktkHBPQc9OPnnSv+PVf+uDf1rV1L/kGW3/XSP+Vef4s+HuS1HKUqev8A",
  "XkfpHh7wpl6y2K5XsX/FPxItB5zwt8rKytgqArKy7VXAYHIAUAj345rwPW/ibH5gjMrgyFlLMQ6YwV5Y9CT0AOMYwc9F1/8A48rj/r6j/wDQlrwjXf8Aj3T/",
  "AK6J/wChrX8u4LhPL8Jiv3Ca17/8A/nTxs4Qy2U5Xi/vPbtG+L1pPdxvPPGZW8pQqfKGGQy7uDjHc4IxXov/AAtSP+9B/wB/R/8AGq+F9C/5Clv/ALsP8lr1",
  "iv33KKfLhYpNn87ZdwVlbpfC9+//AAD/2Q==",
].join("");
