import { Body, Controller, Delete, Get, Headers, Put } from '@nestjs/common';
import { CartService } from './cart.service';
import { ReplaceCartDto } from './dto/replace-cart.dto';

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  findCurrentCart(
    @Headers('x-customer-email') customerEmail?: string,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.cartService.findForCustomer(customerEmail, syncSecret);
  }

  @Put()
  replaceCurrentCart(
    @Body() input: ReplaceCartDto,
    @Headers('x-customer-email') customerEmail?: string,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.cartService.replaceForCustomer(
      input,
      customerEmail,
      syncSecret,
    );
  }

  @Delete()
  clearCurrentCart(
    @Headers('x-customer-email') customerEmail?: string,
    @Headers('x-auth-sync-secret') syncSecret?: string,
  ) {
    return this.cartService.clearForCustomer(customerEmail, syncSecret);
  }
}
