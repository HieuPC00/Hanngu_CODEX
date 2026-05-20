export const correctMessages = [
  "Đúng rồi, tiếp tục tiến độ này nhé.",
  "Chuẩn luôn, nhớ bài tốt nha.",
  "Tốt lắm, qua câu tiếp theo thôi.",
  'Hay, "ngấm" vào đầu rồi nha.',
  "Đúng rồi, phản xạ bắt đầu nhanh hơn rồi á.",
  "Chuẩn, câu này coi như nằm lòng rồi hen.",
  "Chính xác! Thêm câu nữa cho nóng.",
  "Đều tay thế này thì kiểu gì cũng giỏi.",
  "Ngon lành, cứ đi hướng này là chuẩn bài.",
  "Ngon lành, củng cố thêm câu nữa đi."
];

export const wrongMessages = [
  "Chưa chuẩn rồi, nhìn kỹ lại mặt chữ một chút nhé.",
  "Sai chút thôi, sửa lại phát là nhớ ngay.",
  "Hình như chưa khớp lắm, bình tĩnh coi lại xem sao.",
  'Đang đoạn "nạp" kiến thức nên nhầm tí không sao, thử lại nào.',
  "Lỗi này mới giúp mình nhớ lâu, làm lại nhé.",
  "Suýt soát rồi! Kiểm tra lại thứ tự chữ một tẹo thôi.",
  "Chưa chuẩn lắm, đọc kỹ rồi gõ chậm lại chút xem.",
  "Sai là chuyện bình thường, sửa xong là tiến bộ thôi.",
  'Câu này hơi "khoai", thử lại lượt nữa cho chắc tay nào.',
  "Chưa đúng roài, tập trung và làm lại nha."
];

export function pickRandomMessage(messages: string[]) {
  return messages[Math.floor(Math.random() * messages.length)] || "";
}
